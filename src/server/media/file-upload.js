/** 分片上传的创建、断点续传、提交和取消。 */
import {
  contentSectionId,
  gallerySectionId,
  portfolioSectionRecord,
  subsectionIdForSection,
} from "../content/board-lookup.js";
import {
  legacyAssetVisibility,
  normalizedVisibility,
  normalizedDownloadPolicy,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "../content/visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import {
  ASSET_UPLOAD_PART_BYTES,
  ASSET_UPLOAD_TTL_SECONDS,
  ASSET_VARIANT_LABELS,
  LEGACY_ASSET_UPLOAD_PART_BYTES,
  MAX_ASSET_BYTES,
  MAX_UPLOAD_PART_BYTES,
  MAX_UPLOAD_PARTS,
  normalizedAssetKind,
  safeAssetFilename,
  safeRelativePath,
  VIDEO_QUALITY_LABELS,
} from "./formats.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { clampMultilineText, clampText, nowIso, rows, validId } from "../shared/values.js";

async function abortExistingAssetUpload(env, assetId, variantLabel) {
  const existing = await env.DB.prepare(`
    SELECT id, upload_id, object_key FROM asset_uploads WHERE asset_id = ? AND variant_label = ?
  `).bind(assetId, variantLabel).first();
  if (!existing) return;
  try { await env.BUCKET.resumeMultipartUpload(existing.object_key, existing.upload_id).abort(); }
  catch (error) { console.warn("Ignoring stale multipart upload abort", error); }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM asset_upload_parts WHERE upload_session_id = ?").bind(existing.id),
    env.DB.prepare("DELETE FROM asset_uploads WHERE id = ?").bind(existing.id),
  ]);
}

async function createAssetUpload(request, env) {
  if (!env.BUCKET) throw new HttpError(503, "R2 存储桶尚未绑定");
  const body = await readJson(request);
  const filename = safeAssetFilename(body.filename);
  const mimeType = clampText(body.mimeType, 180) || "application/octet-stream";
  const expectedSize = Number(body.sizeBytes);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_ASSET_BYTES) {
    throw new HttpError(413, "文件大小无效或超过 100GiB 上传上限");
  }
  const variantLabel = body.variantLabel ? String(body.variantLabel) : "";
  if (variantLabel && !ASSET_VARIANT_LABELS.has(variantLabel)) throw new HttpError(400, "预览或清晰度标签无效");
  const timestamp = nowIso();
  const datePrefix = timestamp.slice(0, 10);
  let assetId;
  let objectKey;

  if (variantLabel) {
    assetId = String(body.assetId || "");
    if (!validId(assetId)) throw new HttpError(400, "请选择要添加版本的视频或文档");
    const asset = await env.DB.prepare("SELECT id, kind FROM assets WHERE id = ?").bind(assetId).first();
    if (!asset) throw new HttpError(404, "原始文件不存在");
    if (variantLabel === "preview" && !["word", "pdf"].includes(asset.kind)) {
      throw new HttpError(400, "PDF 预览版本只用于 Word/PDF 文档");
    }
    if (variantLabel === "preview" && mimeType !== "application/pdf" && !/\.pdf$/i.test(filename)) {
      throw new HttpError(400, "文档预览版本必须上传 PDF 文件");
    }
    if (VIDEO_QUALITY_LABELS.has(variantLabel) && asset.kind !== "video") {
      throw new HttpError(400, "清晰度版本只用于视频");
    }
    if (VIDEO_QUALITY_LABELS.has(variantLabel) && !mimeType.startsWith("video/")) {
      throw new HttpError(400, "清晰度版本必须上传视频文件");
    }
    objectKey = `assets/${datePrefix}/${assetId}/variants/${variantLabel}-${crypto.randomUUID()}-${filename}`;
    await abortExistingAssetUpload(env, assetId, variantLabel);
    const oldVariant = await env.DB.prepare("SELECT object_key FROM asset_variants WHERE asset_id = ? AND label = ?")
      .bind(assetId, variantLabel).first();
    if (oldVariant?.object_key) await env.BUCKET.delete(oldVariant.object_key);
    await env.DB.prepare(`
      INSERT INTO asset_variants
        (id, asset_id, label, object_key, mime_type, size_bytes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?)
      ON CONFLICT(asset_id, label) DO UPDATE SET object_key = excluded.object_key,
        mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, status = 'uploading', updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), assetId, variantLabel, objectKey, mimeType, expectedSize, timestamp, timestamp).run();
  } else {
    const kind = normalizedAssetKind(body.kind, mimeType, filename);
    const inferredScope = validId(body.sectionId) ? "section" : "library";
    const scope = ["library", "article", "gallery", "section"].includes(body.scope) ? body.scope : inferredScope;
    const folderId = scope === "library" && validId(body.folderId) ? String(body.folderId) : null;
    if (folderId) {
      const folder = await env.DB.prepare("SELECT id FROM asset_folders WHERE id = ?").bind(folderId).first();
      if (!folder) throw new HttpError(400, "目标文件夹不存在");
    }
    assetId = crypto.randomUUID();
    objectKey = `assets/${datePrefix}/${assetId}/original-${filename}`;
    const displayName = clampText(body.displayName, 220) || filename;
    const visibility = normalizedVisibility(body.visibility);
    const legacyVisibility = legacyAssetVisibility(visibility);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, body.allowedUserIds);
    const downloadPolicy = normalizedDownloadPolicy(body.downloadPolicy);
    const relativePath = safeRelativePath(body.relativePath);
    const note = clampMultilineText(body.note, 1200);
    let sectionId = null;
    let subsectionId = null;
    let albumId = null;
    let contentId = null;
    if (scope === "gallery") {
      sectionId = await gallerySectionId(env, body.sectionId);
      subsectionId = await subsectionIdForSection(env, body.subsectionId, sectionId);
      if (validId(body.albumId)) {
        const album = await env.DB.prepare("SELECT id FROM albums WHERE id = ? AND section_id = ?")
          .bind(body.albumId, sectionId).first();
        if (!album) throw new HttpError(400, "视频所选相册不属于当前图片板块");
        albumId = String(body.albumId);
        if (!subsectionId) subsectionId = await subsectionIdForSection(env, albumId, sectionId);
      }
      await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
      if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
      if (albumId) await validateChildAccessSubset(env, "album", albumId, visibility, allowedUserIds);
    } else if (scope === "section") {
      sectionId = await contentSectionId(env, body.sectionId, "article");
      subsectionId = await subsectionIdForSection(env, body.subsectionId, sectionId);
      await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
      if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
    } else if (scope === "article") {
      contentId = validId(body.contentId) ? String(body.contentId) : null;
      if (!contentId) throw new HttpError(400, "文章附件必须绑定当前文章，请先保存文章草稿");
      const content = await env.DB.prepare("SELECT id, section_id, subsection_id FROM content WHERE id = ?").bind(contentId).first();
      if (!content) throw new HttpError(400, "文章附件所绑定的文章不存在");
      sectionId = content.section_id;
      subsectionId = content.subsection_id;
      await validateChildAccessSubset(env, "content", contentId, visibility, allowedUserIds);
    } else {
      sectionId = validId(body.sectionId) ? body.sectionId : RESOURCE_SECTION_ID;
      if ((await portfolioSectionRecord(env, sectionId)).kind !== "resources") throw new HttpError(400, "文件上传请选择文件与视频大板块");
      subsectionId = await subsectionIdForSection(env, body.subsectionId, sectionId);
      await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
      if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
      if (folderId) await validateChildAccessSubset(env, "assetFolder", folderId, visibility, allowedUserIds);
      if (folderId && !(await env.DB.prepare("SELECT id FROM asset_folders WHERE id=? AND section_id=?").bind(folderId, sectionId).first())) throw new HttpError(400, "文件夹不属于当前大板块");
    }
    await env.DB.prepare(`
      INSERT INTO assets
        (id, folder_id, section_id, subsection_id, album_id, content_id, filename, display_name, object_key,
         mime_type, size_bytes, kind, visibility, access_mode, scope, download_policy,
         relative_path, note, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)
    `).bind(
      assetId, folderId, sectionId, subsectionId, albumId, contentId, filename, displayName, objectKey,
      mimeType, expectedSize, kind, legacyVisibility, visibility, scope, downloadPolicy, relativePath, note,
      timestamp, timestamp,
    ).run();
    await replaceAllowedUsers(env, "asset", assetId, allowedUserIds, timestamp);
  }

  let multipart;
  try {
    multipart = await env.BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { assetId, variantLabel, originalName: filename },
    });
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ASSET_UPLOAD_TTL_SECONDS * 1000).toISOString();
    await env.DB.prepare(`
      INSERT INTO asset_uploads
        (id, asset_id, variant_label, upload_id, object_key, mime_type, file_name,
         expected_size, part_size, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId, assetId, variantLabel, multipart.uploadId, objectKey, mimeType, filename,
      expectedSize, ASSET_UPLOAD_PART_BYTES, expiresAt, timestamp,
    ).run();
    return {
      sessionId,
      assetId,
      variantLabel,
      fileName: filename,
      expectedSize,
      partSize: ASSET_UPLOAD_PART_BYTES,
      maxParts: MAX_UPLOAD_PARTS,
      maxFileBytes: MAX_ASSET_BYTES,
      uploadedParts: [],
      resumable: true,
      expiresAt,
    };
  } catch (error) {
    if (multipart) await multipart.abort().catch(() => null);
    if (!variantLabel) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM asset_access_users WHERE asset_id = ?").bind(assetId),
        env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(assetId),
      ]).catch(() => null);
    }
    else await env.DB.prepare("DELETE FROM asset_variants WHERE asset_id = ? AND label = ? AND status = 'uploading'")
      .bind(assetId, variantLabel).run().catch(() => null);
    throw error;
  }
}

async function getAssetUpload(env, id) {
  if (!validId(id)) throw new HttpError(400, "上传会话 ID 错误");
  const upload = await env.DB.prepare("SELECT * FROM asset_uploads WHERE id = ?").bind(id).first();
  if (!upload) throw new HttpError(404, "上传会话不存在或已经结束");
  if (new Date(upload.expires_at).getTime() <= Date.now()) throw new HttpError(410, "上传会话已过期，请重新开始");
  return upload;
}

function assetUploadPartSize(upload) {
  const partSize = Number(upload?.part_size);
  if (Number.isInteger(partSize) && partSize > 0 && partSize <= MAX_UPLOAD_PART_BYTES) return partSize;
  return LEGACY_ASSET_UPLOAD_PART_BYTES;
}

function assetUploadPartCount(upload) {
  return Math.ceil(Number(upload.expected_size) / assetUploadPartSize(upload));
}

async function listAssetUploadParts(env, sessionId) {
  return rows(await env.DB.prepare(`
    SELECT part_number, etag, size_bytes, uploaded_at
    FROM asset_upload_parts
    WHERE upload_session_id = ?
    ORDER BY part_number ASC
  `).bind(sessionId).all()).map((part) => ({
    partNumber: Number(part.part_number),
    etag: String(part.etag || ""),
    sizeBytes: Number(part.size_bytes),
    uploadedAt: part.uploaded_at,
  }));
}

function assetUploadSessionDto(upload, uploadedParts) {
  return {
    sessionId: upload.id,
    assetId: upload.asset_id,
    variantLabel: upload.variant_label,
    fileName: upload.file_name || "",
    expectedSize: Number(upload.expected_size),
    partSize: assetUploadPartSize(upload),
    maxParts: MAX_UPLOAD_PARTS,
    maxFileBytes: MAX_ASSET_BYTES,
    expiresAt: upload.expires_at,
    uploadedParts,
    resumable: true,
  };
}

export async function adminAssetUploads(request, env, id, action, detail) {
  if (!env.BUCKET) throw new HttpError(503, "R2 存储桶尚未绑定");
  if (request.method === "POST" && !id) return createAssetUpload(request, env);
  const upload = await getAssetUpload(env, id);

  if (request.method === "GET" && !action) {
    return assetUploadSessionDto(upload, await listAssetUploadParts(env, upload.id));
  }

  const multipart = env.BUCKET.resumeMultipartUpload(upload.object_key, upload.upload_id);

  if (request.method === "PUT" && action === "part") {
    const partNumber = Number(detail);
    const expectedPartCount = assetUploadPartCount(upload);
    if (!Number.isInteger(partNumber) || partNumber < 1
      || partNumber > expectedPartCount || partNumber > MAX_UPLOAD_PARTS) {
      throw new HttpError(400, "分片编号无效");
    }
    const contentLengthHeader = request.headers.get("Content-Length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    const partSize = assetUploadPartSize(upload);
    const expectedPartSize = Math.min(
      partSize,
      Number(upload.expected_size) - ((partNumber - 1) * partSize),
    );
    if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength !== expectedPartSize)) {
      throw new HttpError(400, `第 ${partNumber} 个分片大小不正确`);
    }
    if (contentLength !== null && (contentLength <= 0 || contentLength > MAX_UPLOAD_PART_BYTES)) {
      throw new HttpError(413, "单个上传分片不能超过 95MB");
    }
    if (!request.body) throw new HttpError(400, "上传分片为空");
    // FixedLengthStream 保留 R2 所需的已知长度标记，并在不缓存整片的前提下
    // 拒绝短片或超长片；64MiB 分片始终以流的形式穿过 Worker。
    const fixedLengthBody = new FixedLengthStream(expectedPartSize);
    const piping = request.body.pipeTo(fixedLengthBody.writable);
    let uploadedPart;
    try {
      [uploadedPart] = await Promise.all([
        multipart.uploadPart(partNumber, fixedLengthBody.readable),
        piping,
      ]);
    } catch (error) {
      if (contentLength === null && /length|fixed|bytes|stream/i.test(String(error?.message || ""))) {
        throw new HttpError(400, `第 ${partNumber} 个分片大小不正确`);
      }
      throw error;
    }
    const uploadedAt = nowIso();
    await env.DB.prepare(`
      INSERT INTO asset_upload_parts (upload_session_id, part_number, etag, size_bytes, uploaded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(upload_session_id, part_number) DO UPDATE SET
        etag = excluded.etag,
        size_bytes = excluded.size_bytes,
        uploaded_at = excluded.uploaded_at
    `).bind(upload.id, uploadedPart.partNumber, uploadedPart.etag, expectedPartSize, uploadedAt).run();
    return {
      partNumber: uploadedPart.partNumber,
      etag: uploadedPart.etag,
      sizeBytes: expectedPartSize,
      uploadedAt,
    };
  }

  if (request.method === "POST" && action === "complete") {
    const body = await readJson(request);
    const persistedParts = await listAssetUploadParts(env, upload.id);
    const partMap = new Map();
    // 兼容升级前只把 ETag 保存在当前浏览器内存中的 32MiB 会话。
    if (assetUploadPartSize(upload) === LEGACY_ASSET_UPLOAD_PART_BYTES && Array.isArray(body.parts)) {
      for (const part of body.parts) {
        const partNumber = Number(part?.partNumber);
        const etag = String(part?.etag || "");
        if (Number.isInteger(partNumber) && partNumber > 0 && etag) {
          partMap.set(partNumber, { partNumber, etag, sizeBytes: null });
        }
      }
    }
    for (const part of persistedParts) partMap.set(part.partNumber, part);
    const completedPartRecords = [...partMap.values()].sort((a, b) => a.partNumber - b.partNumber);
    const expectedPartCount = assetUploadPartCount(upload);
    if (completedPartRecords.length !== expectedPartCount || completedPartRecords.length > MAX_UPLOAD_PARTS
      || completedPartRecords.some((part, index) => !Number.isInteger(part.partNumber)
        || part.partNumber !== index + 1 || !part.etag)) {
      throw new HttpError(400, "上传分片清单不完整");
    }
    const partSize = assetUploadPartSize(upload);
    if (completedPartRecords.some((part, index) => part.sizeBytes !== null
      && part.sizeBytes !== Math.min(partSize, Number(upload.expected_size) - (index * partSize)))) {
      throw new HttpError(400, "上传分片大小校验失败");
    }
    if (partSize !== LEGACY_ASSET_UPLOAD_PART_BYTES && persistedParts.length !== expectedPartCount) {
      throw new HttpError(400, "服务器未记录完整的上传分片");
    }
    const completedParts = completedPartRecords.map(({ partNumber, etag }) => ({ partNumber, etag }));
    if (!completedParts.length
      || completedParts.some((part, index) => !Number.isInteger(part.partNumber)
        || part.partNumber !== index + 1 || !part.etag)) {
      throw new HttpError(400, "上传分片清单不完整");
    }
    let object = null;
    try {
      await multipart.complete(completedParts);
    } catch (error) {
      // 合并响应若在网络途中丢失，R2 中的对象可能已经完成；先核验对象，
      // 避免管理员重新选择 100GiB 文件后被迫从零上传。
      object = await env.BUCKET.head(upload.object_key).catch(() => null);
      if (!object || Number(object.size) !== Number(upload.expected_size)) throw error;
    }
    if (!object) object = await env.BUCKET.head(upload.object_key);
    if (!object) throw new HttpError(500, "R2 合并完成后未找到文件");
    if (Number(upload.expected_size) && Number(object.size) !== Number(upload.expected_size)) {
      await env.BUCKET.delete(upload.object_key);
      const timestamp = nowIso();
      if (upload.variant_label) {
        await env.DB.prepare("UPDATE asset_variants SET status = 'failed', updated_at = ? WHERE asset_id = ? AND label = ?")
          .bind(timestamp, upload.asset_id, upload.variant_label).run();
      } else {
        await env.DB.prepare("UPDATE assets SET status = 'failed', updated_at = ? WHERE id = ?")
          .bind(timestamp, upload.asset_id).run();
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM asset_upload_parts WHERE upload_session_id = ?").bind(upload.id),
        env.DB.prepare("DELETE FROM asset_uploads WHERE id = ?").bind(upload.id),
      ]);
      throw new HttpError(400, "上传后的文件大小与原文件不一致，请重试");
    }
    const timestamp = nowIso();
    if (upload.variant_label) {
      await env.DB.prepare(`
        UPDATE asset_variants SET size_bytes = ?, status = 'ready', updated_at = ?
        WHERE asset_id = ? AND label = ?
      `).bind(object.size, timestamp, upload.asset_id, upload.variant_label).run();
    } else {
      await env.DB.prepare(`
        UPDATE assets SET size_bytes = ?, status = 'ready', updated_at = ? WHERE id = ?
      `).bind(object.size, timestamp, upload.asset_id).run();
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM asset_upload_parts WHERE upload_session_id = ?").bind(upload.id),
      env.DB.prepare("DELETE FROM asset_uploads WHERE id = ?").bind(upload.id),
    ]);
    return { ok: true, assetId: upload.asset_id, variantLabel: upload.variant_label, sizeBytes: object.size };
  }

  if (request.method === "DELETE" && !action) {
    await multipart.abort().catch(() => null);
    await env.BUCKET.delete(upload.object_key).catch(() => null);
    const statements = [
      env.DB.prepare("DELETE FROM asset_upload_parts WHERE upload_session_id = ?").bind(upload.id),
      env.DB.prepare("DELETE FROM asset_uploads WHERE id = ?").bind(upload.id),
    ];
    if (upload.variant_label) {
      statements.push(env.DB.prepare(
        "DELETE FROM asset_variants WHERE asset_id = ? AND label = ? AND status = 'uploading'",
      ).bind(upload.asset_id, upload.variant_label));
    } else {
      statements.push(
        env.DB.prepare("DELETE FROM asset_access_users WHERE asset_id = ?").bind(upload.asset_id),
        env.DB.prepare("DELETE FROM assets WHERE id = ? AND status = 'uploading'").bind(upload.asset_id),
      );
    }
    await env.DB.batch(statements);
    return { ok: true, removed: true };
  }
  throw new HttpError(405, "不支持的上传操作");
}
