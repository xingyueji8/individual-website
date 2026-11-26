/** Studio 照片上传、压缩预览、查重、移动和删除。 */
import { portfolioSectionRecord, subsectionIdForSection } from "../content/board-lookup.js";
import {
  attachAllowedUserIds,
  normalizedVisibility,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "../content/visibility.js";
import { readJson } from "../http/request.js";
import { HttpError, SECURITY_HEADERS } from "../http/responses.js";
import { MAX_IMAGE_BYTES, MAX_PREVIEW_BYTES } from "./formats.js";
import { mediaDto } from "./metadata.js";
import { clampMultilineText, clampText, nowIso, rows, validId } from "../shared/values.js";

async function uploadMedia(request, env) {
  if (!env.BUCKET) throw new HttpError(503, "R2 存储桶尚未绑定");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new HttpError(400, "请选择图片文件");
  const heic = /\.(heic|heif)$/i.test(file.name) || ["image/heic", "image/heif"].includes(file.type);
  const mimeType = heic ? "image/heic" : file.type;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic"]);
  if (!allowedTypes.has(mimeType)) throw new HttpError(400, "支持 JPG、PNG、WebP、GIF、AVIF、HEIC/HEIF 图片");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "单张图片不能超过 20MB");
  if (heic) {
    const header = new TextDecoder("latin1").decode(await file.slice(0, 80).arrayBuffer());
    if (header.slice(4, 8) !== "ftyp" || !/(heic|heix|hevc|hevx|mif1|msf1)/.test(header.slice(8))) throw new HttpError(400, "文件不是有效的 HEIC/HEIF 容器");
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
  const uploadToken = form.get("uploadToken");
  if (uploadToken && (typeof uploadToken !== "string" || !/^[a-f0-9-]{36}$/.test(uploadToken))) throw new HttpError(400, "上传标识无效");
  if (uploadToken) {
    if (await env.DB.prepare("SELECT token FROM photo_upload_cancellations WHERE token=?").bind(uploadToken).first()) throw new HttpError(409, "上传已取消");
    const existingUpload = await env.DB.prepare("SELECT * FROM media WHERE upload_token=?").bind(uploadToken).first();
    if (existingUpload) {
      if (existingUpload.sha256 !== digest) throw new HttpError(409, "上传标识与文件不匹配");
      return mediaDto(existingUpload);
    }
  }
  const duplicate = await env.DB.prepare("SELECT id,filename FROM media WHERE sha256=? LIMIT 1").bind(digest).first();
  if (duplicate && form.get("allowDuplicate") !== "1") throw new HttpError(409, `检测到重复图片“${duplicate.filename}”，请确认是否仍要上传`);

  /*
   * 预览件由后台页面从同一原图生成。Worker 只接受 WebP，并独立限制体积；
   * 即使请求被手工篡改，也不能把任意大文件写入 previews/ 目录。
   */
  const preview = form.get("preview");
  const previewFile = preview instanceof File && preview.size ? preview : null;
  if (previewFile && previewFile.type !== "image/webp") throw new HttpError(400, "压缩预览必须是 WebP 图片");
  if (previewFile && previewFile.size > MAX_PREVIEW_BYTES) throw new HttpError(413, "压缩预览不能超过 4MB");
  if (heic && !previewFile) throw new HttpError(400, "HEIC 原片需要同时生成浏览器可显示的预览，请等待转换完成后上传");
  const mosaic = form.get("mosaic");
  const mosaicFile = mosaic instanceof File && mosaic.size ? mosaic : null;
  if (mosaicFile && (mosaicFile.type !== "image/webp" || mosaicFile.size > 64 * 1024)) throw new HttpError(400, "马赛克预览格式或大小无效");

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || `${id}.img`;
  const objectKey = `media/${new Date().toISOString().slice(0, 10)}/${id}-${safeName}`;
  const previewObjectKey = previewFile ? `previews/${new Date().toISOString().slice(0, 10)}/${id}.webp` : null;
  const mosaicObjectKey = mosaicFile ? `mosaics/${id}.webp` : null;
  const albumId = validId(form.get("albumId")) ? String(form.get("albumId")) : null;
  let subsectionId = validId(form.get("subsectionId")) ? String(form.get("subsectionId")) : null;
  const caption = clampText(form.get("caption"), 500);
  const kind = form.get("kind") === "inline" ? "inline" : "photo";
  // 图片专栏与文章插图都接受四级权限，后端不能依赖前端下拉框自行保证安全。
  const visibility = normalizedVisibility(form.get("visibility"));
  const allowedUserIds = await validatedAllowedUserIds(env, visibility, form.get("allowedUserIds"));
  let sectionId = null;
  let contentId = null;
  if (kind === "photo") {
    if (albumId) {
      const album = await env.DB.prepare("SELECT section_id FROM albums WHERE id = ?").bind(albumId).first();
      if (!album) throw new HttpError(400, "所选相册不存在");
      sectionId = (await portfolioSectionRecord(env, album.section_id)).id;
      if (!subsectionId) subsectionId = await subsectionIdForSection(env, albumId, sectionId);
    } else {
      sectionId = (await portfolioSectionRecord(env, form.get("sectionId"))).id;
    }
    subsectionId = await subsectionIdForSection(env, subsectionId, sectionId);
    await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
    if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
    if (albumId) await validateChildAccessSubset(env, "album", albumId, visibility, allowedUserIds);
  } else if (form.get("contentId")) {
    if (!validId(form.get("contentId"))) throw new HttpError(400, "文章 ID 无效");
    const article = await env.DB.prepare("SELECT id,section_id,subsection_id FROM content WHERE id=?").bind(form.get("contentId")).first();
    if (!article) throw new HttpError(400, "所属文章不存在，请先保存文章");
    contentId = article.id; sectionId = article.section_id; subsectionId = article.subsection_id;
    await validateChildAccessSubset(env, "content", contentId, visibility, allowedUserIds);
  }
  const timestamp = nowIso();

  try {
    // 原片永远单独保存，下载接口不会被预览图替代。
    await env.BUCKET.put(objectKey, file.stream(), {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalName: file.name, kind },
    });
    if (previewFile) {
      await env.BUCKET.put(previewObjectKey, previewFile.stream(), {
        httpMetadata: { contentType: "image/webp" },
        customMetadata: { originalMediaId: id, purpose: "preview" },
      });
    }
    if (mosaicFile) await env.BUCKET.put(mosaicObjectKey, mosaicFile.stream(), { httpMetadata: { contentType: "image/webp" } });
    const inserted = await env.DB.prepare(`
      INSERT INTO media
        (id, object_key, preview_object_key, filename, mime_type, size_bytes, section_id,
         subsection_id, album_id, caption, kind, visibility, created_at, updated_at, sha256, upload_token, mosaic_object_key, content_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM photo_upload_cancellations WHERE token=?)
    `).bind(
      id, objectKey, previewObjectKey, file.name.slice(0, 240), mimeType, file.size,
      sectionId, subsectionId, albumId, caption, kind, visibility, timestamp, timestamp, digest, uploadToken || null, mosaicObjectKey, contentId, uploadToken || "",
    ).run();
    if (!inserted.meta.changes) throw new HttpError(409, "上传已取消");
    await replaceAllowedUsers(env, "media", id, allowedUserIds, timestamp);
  } catch (error) {
    // 任一步失败都清理已经写入的对象，避免 R2 留下数据库无法管理的孤立文件。
    await env.BUCKET.delete(objectKey).catch(() => null);
    if (previewObjectKey) await env.BUCKET.delete(previewObjectKey).catch(() => null);
    if (mosaicObjectKey) await env.BUCKET.delete(mosaicObjectKey).catch(() => null);
    await env.DB.prepare("DELETE FROM media_access_users WHERE media_id = ?").bind(id).run().catch(() => null);
    await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run().catch(() => null);
    // A timed-out request and its retry may finish together. Keep the first
    // committed image and return it, rather than create a duplicate.
    if (uploadToken) {
      const completed = await env.DB.prepare("SELECT * FROM media WHERE upload_token=? AND sha256=?").bind(uploadToken, digest).first();
      if (completed) return mediaDto(completed);
    }
    throw error;
  }
  return mediaDto({
    id, preview_object_key: previewObjectKey, mosaic_object_key: mosaicObjectKey, filename: file.name, mime_type: mimeType,
    size_bytes: file.size, section_id: sectionId, subsection_id: subsectionId, album_id: albumId, content_id: contentId, caption, kind,
    visibility, allowed_user_ids: allowedUserIds, created_at: timestamp, updated_at: timestamp,
  });
}

/* 给升级前已有的 R2 原片补建压缩预览，不会重新写入或覆盖原片。 */
async function updateMediaPreview(request, env, id) {
  if (request.method !== "POST") throw new HttpError(405, "不支持的请求方法");
  if (!validId(id)) throw new HttpError(400, "图片 ID 错误");
  const media = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first();
  if (!media) throw new HttpError(404, "图片不存在");

  const form = await request.formData();
  const preview = form.get("preview");
  if (!(preview instanceof File) || !preview.size) throw new HttpError(400, "缺少压缩预览");
  if (preview.type !== "image/webp") throw new HttpError(400, "压缩预览必须是 WebP 图片");
  if (preview.size > MAX_PREVIEW_BYTES) throw new HttpError(413, "压缩预览不能超过 4MB");

  const previewObjectKey = `previews/${new Date().toISOString().slice(0, 10)}/${id}-${crypto.randomUUID()}.webp`;
  await env.BUCKET.put(previewObjectKey, preview.stream(), {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { originalMediaId: id, purpose: "preview" },
  });
  const timestamp = nowIso();
  try {
    await env.DB.prepare("UPDATE media SET preview_object_key = ?, updated_at = ? WHERE id = ?")
      .bind(previewObjectKey, timestamp, id).run();
  } catch (error) {
    await env.BUCKET.delete(previewObjectKey).catch(() => null);
    throw error;
  }
  if (media.preview_object_key && media.preview_object_key !== previewObjectKey) {
    await env.BUCKET.delete(media.preview_object_key).catch(() => null);
  }
  return mediaDto({ ...media, preview_object_key: previewObjectKey, updated_at: timestamp });
}

async function mediaDuplicates(request, env) {
  if (request.method !== "POST") throw new HttpError(405, "不支持的请求方法");
  const input = await readJson(request);
  if (!Array.isArray(input.files) || input.files.length > 100) throw new HttpError(400, "一次最多检查 100 张照片");
  const existing = rows(await env.DB.prepare("SELECT id,filename,size_bytes,sha256 FROM media").all());
  return input.files.map(file => {
    const match = existing.find(row => /^[a-f0-9]{64}$/.test(file.sha256) && row.sha256 === file.sha256)
      || existing.find(row => !row.sha256 && row.filename === file.name && row.size_bytes === file.size);
    return { sha256: file.sha256, duplicate: Boolean(match), exact: Boolean(match?.sha256), name: match?.filename || "" };
  });
}

// Only handleAdmin can reach these byte routes. Public/guest routes never use
// the Studio cookie to bypass the visitor's explicitly selected guest identity.
async function studioMediaSource(request, env, id) {
  if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "不支持的请求方法");
  const row = await env.DB.prepare("SELECT object_key,preview_object_key,mime_type,filename FROM media WHERE id=?").bind(id).first();
  if (!row) throw new HttpError(404, "图片不存在");
  const params = new URL(request.url).searchParams;
  const preview = params.get("preview") === "1" && row.preview_object_key;
  const object = await env.BUCKET.get(preview || row.object_key);
  if (!object) throw new HttpError(404, "图片文件不存在");
  return new Response(request.method === "HEAD" ? null : object.body, { headers: {
    ...SECURITY_HEADERS, "Content-Type": preview ? "image/webp" : row.mime_type,
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${params.get("download") === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  } });
}

async function updateMediaMosaic(request, env, id) {
  if (request.method !== "POST") throw new HttpError(405, "不支持的请求方法");
  const row = await env.DB.prepare("SELECT id,mosaic_object_key FROM media WHERE id=?").bind(id).first();
  if (!row) throw new HttpError(404, "图片不存在");
  const mosaic = (await request.formData()).get("mosaic");
  if (!(mosaic instanceof File) || !mosaic.size || mosaic.size > 64 * 1024 || mosaic.type !== "image/webp") throw new HttpError(400, "马赛克预览格式或大小无效");
  const key = `mosaics/${id}-${crypto.randomUUID()}.webp`;
  await env.BUCKET.put(key, mosaic.stream(), { httpMetadata: { contentType: "image/webp" } });
  try {
    const result = await env.DB.prepare("UPDATE media SET mosaic_object_key=? WHERE id=?").bind(key, id).run();
    if (!result.meta.changes) throw new HttpError(409, "图片已删除，请刷新列表");
  } catch (error) { await env.BUCKET.delete(key).catch(() => null); throw error; }
  if (row.mosaic_object_key) await env.BUCKET.delete(row.mosaic_object_key).catch(() => null);
  return { ok: true, hasMosaic: true };
}

async function moveMediaBatch(request, env, suppliedInput) {
  if (request.method !== "POST") throw new HttpError(405, "移动照片请使用 POST 请求");
  const input = suppliedInput || await readJson(request);
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 200 || input.ids.some(id => typeof id !== "string" || !validId(id))) throw new HttpError(400, "请勾选 1–200 张照片");
  const ids = [...new Set(input.ids)];
  const section = await portfolioSectionRecord(env, input.sectionId);
  if (section.kind !== "gallery") throw new HttpError(400, "照片只能移动到图片类大板块");
  if (!Object.prototype.hasOwnProperty.call(input, "subsectionId") || (input.subsectionId && (typeof input.subsectionId !== "string" || !validId(input.subsectionId)))) throw new HttpError(400, "请选择有效的目标小板块");
  const subsectionId = await subsectionIdForSection(env, input.subsectionId, section.id);
  const items = rows(await env.DB.prepare(`SELECT m.* FROM media m JOIN portfolio_sections s ON s.id=m.section_id
    WHERE m.id IN (SELECT value FROM json_each(?)) AND m.kind='photo'`).bind(JSON.stringify(ids)).all());
  if (items.length !== ids.length) throw new HttpError(409, "部分照片已删除或不属于图片板块，请刷新后重新选择");
  const withAccess = await attachAllowedUserIds(env, "media", items);
  const parents = [{ ...section, targetKind: "section" }];
  let cursor = subsectionId;
  while (cursor) {
    const parent = await env.DB.prepare("SELECT * FROM portfolio_subsections WHERE id=? AND section_id=?").bind(cursor, section.id).first();
    if (!parent || parents.some(item => item.id === cursor)) throw new HttpError(400, "目标板块层级无效");
    parents.push({ ...parent, targetKind: "subsection" }); cursor = parent.parent_id;
  }
  for (const parent of parents) {
    const [accessParent] = await attachAllowedUserIds(env, parent.targetKind, [parent]);
    for (const item of withAccess.filter(photo => photo.visibility === "selected")) {
      const allowed = new Set(accessParent.allowed_user_ids);
      if (parent.visibility === "private" || (parent.visibility === "selected" && item.allowed_user_ids.some(id => !allowed.has(id)))
        || (parent.visibility === "excluded" && item.allowed_user_ids.some(id => allowed.has(id)))) throw new HttpError(400, "目标板块的查看范围不包含照片的全部指定用户，请先调整权限");
    }
  }
  const timestamp = nowIso();
  const snapshot = JSON.stringify(items.map(item => ({ id: item.id, updated: item.updated_at })));
  const updated = await env.DB.prepare(`UPDATE media SET section_id=?,subsection_id=?,album_id=NULL,updated_at=?
    WHERE id IN (SELECT value FROM json_each(?)) AND
      (SELECT COUNT(*) FROM media m JOIN json_each(?) snapshot ON m.id=json_extract(snapshot.value,'$.id')
        AND m.updated_at=json_extract(snapshot.value,'$.updated'))=?`)
    .bind(section.id, subsectionId, timestamp, JSON.stringify(ids), snapshot, ids.length).run();
  if (updated.meta.changes !== ids.length) throw new HttpError(409, "照片在移动前已被修改，请刷新后重试；本次没有移动照片");
  return { moved: ids.length, ids, section_id: section.id, subsection_id: subsectionId, updated_at: timestamp };
}

async function moveMediaPhoto(request, env, id) {
  if (request.method !== "POST") throw new HttpError(405, "移动照片请使用 POST 请求");
  if (!validId(id)) throw new HttpError(400, "图片 ID 错误");
  const existing = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first();
  if (!existing) throw new HttpError(404, "图片不存在");
  if (existing.kind !== "photo") throw new HttpError(400, "文章内的插图不能通过此入口移动");
  const section = await portfolioSectionRecord(env, existing.section_id);
  if (section.kind !== "gallery") throw new HttpError(400, "此入口只用于图片板块中的照片");

  const body = await readJson(request);
  if (!Object.prototype.hasOwnProperty.call(body, "subsectionId")) throw new HttpError(400, "请选择目标小板块，或选择未分类");
  const requestedId = body.subsectionId;
  if (requestedId !== null && requestedId !== "" && (typeof requestedId !== "string" || !validId(requestedId))) {
    throw new HttpError(400, "目标小板块 ID 错误");
  }
  const subsectionId = await subsectionIdForSection(env, requestedId, section.id);
  // Single and batch moves share the complete three-level validation.
  const moved = await moveMediaBatch(request, env, { ids: [id], sectionId: section.id, subsectionId });
  const subsection = subsectionId
    ? await env.DB.prepare("SELECT name FROM portfolio_subsections WHERE id = ?").bind(subsectionId).first()
    : null;
  const subsectionCounts = rows(await env.DB.prepare(`
    SELECT ss.id, (SELECT COUNT(*) FROM media m WHERE m.subsection_id = ss.id AND m.kind = 'photo') AS media_count
    FROM portfolio_subsections ss WHERE ss.id IN (?, ?)
  `).bind(existing.subsection_id, subsectionId).all());
  return {
    id, section_id: section.id, subsection_id: subsectionId, subsection_name: subsection?.name || null,
    album_id: null, updated_at: moved.updated_at, subsectionCounts,
  };
}

export async function adminMedia(request, env, id, action = "") {
  if (id === "batch-move") return moveMediaBatch(request, env);
  if (id === "duplicates") return mediaDuplicates(request, env);
  if (action === "source") return studioMediaSource(request, env, id);
  if (action === "mosaic") return updateMediaMosaic(request, env, id);
  if (action === "move") return moveMediaPhoto(request, env, id);
  if (action === "preview") return updateMediaPreview(request, env, id);
  if (request.method === "GET") {
    const items = rows(await env.DB.prepare(`
      SELECT m.*, a.name AS album_name, ss.name AS subsection_name
      FROM media m LEFT JOIN albums a ON a.id = m.album_id
      LEFT JOIN portfolio_subsections ss ON ss.id = m.subsection_id
      ORDER BY m.created_at DESC
    `).all());
    return (await attachAllowedUserIds(env, "media", items)).map(mediaDto);
  }
  if (request.method === "POST") return uploadMedia(request, env);
  if (request.method === "PUT") {
    if (!validId(id)) throw new HttpError(400, "图片 ID 错误");
    const existing = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "图片不存在");
    const body = await readJson(request);
    const albumId = Object.prototype.hasOwnProperty.call(body, "albumId")
      ? (validId(body.albumId) ? body.albumId : null)
      : existing.album_id;
    let subsectionId = Object.prototype.hasOwnProperty.call(body, "subsectionId")
      ? (validId(body.subsectionId) ? String(body.subsectionId) : null)
      : existing.subsection_id;
    const caption = clampText(body.caption ?? existing.caption, 500);
    const note = clampMultilineText(body.note ?? existing.note, 600);
    const kind = existing.kind; // Metadata edits never convert article images to gallery photos.
    const visibility = normalizedVisibility(body.visibility ?? existing.visibility);
    const currentIds = rows(await env.DB.prepare("SELECT user_id FROM media_access_users WHERE media_id=?").bind(id).all()).map(row => row.user_id);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, body.allowedUserIds ?? currentIds);
    let sectionId = existing.section_id;
    if (kind === "photo") {
      if (albumId) {
        const album = await env.DB.prepare("SELECT section_id FROM albums WHERE id = ?").bind(albumId).first();
        if (!album) throw new HttpError(400, "所选相册不存在");
        sectionId = (await portfolioSectionRecord(env, album.section_id)).id;
        if (!subsectionId) subsectionId = await subsectionIdForSection(env, albumId, sectionId);
      } else {
        sectionId = (await portfolioSectionRecord(env, body.sectionId || existing.section_id)).id;
      }
      subsectionId = await subsectionIdForSection(env, subsectionId, sectionId);
      await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
      if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
      if (albumId) await validateChildAccessSubset(env, "album", albumId, visibility, allowedUserIds);
    }
    await env.DB.prepare("UPDATE media SET section_id = ?, subsection_id = ?, album_id = ?, caption = ?, note = ?, kind = ?, visibility = ?, updated_at = ? WHERE id = ?")
      .bind(sectionId, subsectionId, albumId, caption, note, kind, visibility, nowIso(), id).run();
    await replaceAllowedUsers(env, "media", id, allowedUserIds);
    return { id, note, visibility, allowed_user_ids: allowedUserIds };
  }
  if (request.method === "DELETE") {
    const media = await env.DB.prepare(
      "SELECT object_key, preview_object_key, mosaic_object_key FROM media WHERE id = ?",
    ).bind(id).first();
    if (media) {
      await env.BUCKET.delete(media.object_key);
      if (media.preview_object_key) await env.BUCKET.delete(media.preview_object_key);
      if (media.mosaic_object_key) await env.BUCKET.delete(media.mosaic_object_key);
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE content SET cover_media_id = NULL WHERE cover_media_id = ?").bind(id),
      env.DB.prepare("DELETE FROM media_access_users WHERE media_id = ?").bind(id),
      env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id),
    ]);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
