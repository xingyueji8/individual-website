/** Studio 文件清单、文件说明、权限与视频封面。 */
import { subsectionIdForSection } from "../content/board-lookup.js";
import {
  attachAllowedUserIds,
  legacyAssetVisibility,
  normalizedVisibility,
  normalizedDownloadPolicy,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "../content/visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { cleanupExpiredAssetUploads, deleteAssetObjects } from "./file-storage.js";
import { MAX_PREVIEW_BYTES } from "./formats.js";
import { assetDto } from "./metadata.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { clampMultilineText, clampText, nowIso, rows, validId } from "../shared/values.js";

async function listAdminAssets(env) {
  const [assetResult, variantResult, uploadResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, folder_id, section_id, subsection_id, album_id, content_id, filename, display_name, mime_type, size_bytes, kind,
             visibility, access_mode, scope, poster_object_key,
             download_policy, relative_path, note, status, stream_uid, stream_hls_url,
             stream_dash_url, poster_url, created_at, updated_at
      FROM assets ORDER BY created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT id, asset_id, label, mime_type, size_bytes, status, created_at, updated_at
      FROM asset_variants ORDER BY created_at ASC
    `).all(),
    env.DB.prepare(`
      SELECT u.id, u.asset_id, u.variant_label, u.file_name, u.mime_type, u.expected_size,
             u.part_size, u.expires_at, u.created_at,
             COALESCE(SUM(p.size_bytes), 0) AS uploaded_size,
             COUNT(p.part_number) AS uploaded_part_count
      FROM asset_uploads u
      LEFT JOIN asset_upload_parts p ON p.upload_session_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at ASC
    `).all(),
  ]);
  const variants = new Map();
  const uploads = new Map();
  for (const row of rows(variantResult)) {
    if (!variants.has(row.asset_id)) variants.set(row.asset_id, []);
    variants.get(row.asset_id).push(row);
  }
  for (const row of rows(uploadResult)) {
    if (!uploads.has(row.asset_id)) uploads.set(row.asset_id, []);
    uploads.get(row.asset_id).push(row);
  }
  const items = rows(assetResult).map((row) => ({
    ...assetDto(row, variants.get(row.id) || [], { includeDownload: true }),
    uploads: uploads.get(row.id) || [],
  }));
  return attachAllowedUserIds(env, "asset", items);
}

async function updateAssetPoster(request, env, id) {
  if (request.method !== "POST") throw new HttpError(405, "不支持的请求方法");
  if (!validId(id)) throw new HttpError(400, "文件 ID 错误");
  const asset = await env.DB.prepare("SELECT id, kind, poster_object_key FROM assets WHERE id = ?").bind(id).first();
  if (!asset || asset.kind !== "video") throw new HttpError(400, "只能给已经上传的视频设置封面");
  const form = await request.formData();
  const file = form.get("poster");
  if (!(file instanceof File) || !file.size) throw new HttpError(400, "请选择视频封面图片");
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) {
    throw new HttpError(400, "视频封面仅支持 JPG、PNG、WebP 或 AVIF");
  }
  if (file.size > MAX_PREVIEW_BYTES) throw new HttpError(413, "视频封面不能超过 4MB");
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const objectKey = `asset-posters/${new Date().toISOString().slice(0, 10)}/${id}-${crypto.randomUUID()}.${extension}`;
  await env.BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { assetId: id, purpose: "video-poster" },
  });
  try {
    await env.DB.prepare("UPDATE assets SET poster_object_key = ?, updated_at = ? WHERE id = ?")
      .bind(objectKey, nowIso(), id).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey).catch(() => null);
    throw error;
  }
  if (asset.poster_object_key) await env.BUCKET.delete(asset.poster_object_key).catch(() => null);
  return { id, poster_url: `/files/${id}?poster=1` };
}

export async function adminAssets(request, env, id, action = "") {
  if (action === "poster") return updateAssetPoster(request, env, id);
  if (request.method === "GET") {
    await cleanupExpiredAssetUploads(env);
    return listAdminAssets(env);
  }
  if (request.method === "PUT") {
    if (!validId(id)) throw new HttpError(400, "文件 ID 错误");
    const existing = await env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "文件不存在");
    const body = await readJson(request);
    const displayName = clampText(body.displayName ?? existing.display_name, 220) || existing.filename;
    const folderId = (existing.scope || "library") === "library"
      ? (body.folderId === null || body.folderId === ""
        ? null
        : (validId(body.folderId) ? String(body.folderId) : existing.folder_id))
      : null;
    if (folderId) {
      const folder = await env.DB.prepare("SELECT id, section_id FROM asset_folders WHERE id = ?").bind(folderId).first();
      if (!folder) throw new HttpError(400, "目标文件夹不存在");
      if ((folder.section_id || RESOURCE_SECTION_ID) !== (existing.section_id || RESOURCE_SECTION_ID)) throw new HttpError(400, "文件夹不属于当前大板块");
    }
    const visibility = normalizedVisibility(body.visibility ?? existing.access_mode ?? existing.visibility);
    const legacyVisibility = legacyAssetVisibility(visibility);
    let allowedInput = body.allowedUserIds;
    if (!Object.prototype.hasOwnProperty.call(body, "allowedUserIds") && ["selected", "excluded"].includes(visibility)) {
      const currentAllowed = await env.DB.prepare("SELECT user_id FROM asset_access_users WHERE asset_id = ?")
        .bind(id).all();
      allowedInput = rows(currentAllowed).map((item) => item.user_id);
    }
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, allowedInput);
    const subsectionId = Object.prototype.hasOwnProperty.call(body, "subsectionId")
      ? await subsectionIdForSection(env, body.subsectionId, existing.section_id)
      : existing.subsection_id;
    if (folderId) await validateChildAccessSubset(env, "assetFolder", folderId, visibility, allowedUserIds);
    if ((existing.scope || "library") === "library") {
      await validateChildAccessSubset(env, "section", existing.section_id || RESOURCE_SECTION_ID, visibility, allowedUserIds);
    }
    if (existing.section_id) await validateChildAccessSubset(env, "section", existing.section_id, visibility, allowedUserIds);
    if (subsectionId) await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
    if (existing.album_id) await validateChildAccessSubset(env, "album", existing.album_id, visibility, allowedUserIds);
    if (existing.content_id) await validateChildAccessSubset(env, "content", existing.content_id, visibility, allowedUserIds);
    const downloadPolicy = normalizedDownloadPolicy(body.downloadPolicy ?? existing.download_policy);
    const streamUid = clampText(body.streamUid ?? existing.stream_uid, 240);
    const streamHlsUrl = clampText(body.streamHlsUrl ?? existing.stream_hls_url, 1200);
    const streamDashUrl = clampText(body.streamDashUrl ?? existing.stream_dash_url, 1200);
    const posterUrl = clampText(body.posterUrl ?? existing.poster_url, 1200);
    const note = clampMultilineText(body.note ?? existing.note, 1200);
    for (const candidate of [streamHlsUrl, streamDashUrl, posterUrl]) {
      if (candidate && !/^https:\/\//i.test(candidate)) throw new HttpError(400, "播放或封面地址必须使用 HTTPS");
    }
    await env.DB.prepare(`
      UPDATE assets SET folder_id = ?, subsection_id = ?, display_name = ?, note = ?, visibility = ?, access_mode = ?, download_policy = ?,
        stream_uid = ?, stream_hls_url = ?, stream_dash_url = ?, poster_url = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      folderId, subsectionId, displayName, note, legacyVisibility, visibility, downloadPolicy, streamUid, streamHlsUrl,
      streamDashUrl, posterUrl, nowIso(), id,
    ).run();
    await replaceAllowedUsers(env, "asset", id, allowedUserIds);
    return { id, allowed_user_ids: allowedUserIds };
  }
  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "文件 ID 错误");
    await deleteAssetObjects(env, id);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
