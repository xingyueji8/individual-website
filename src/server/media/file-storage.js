/** 删除文件对象和清理过期的 R2 分片。 */
import { HttpError } from "../http/responses.js";
import { nowIso, rows } from "../shared/values.js";

export async function cleanupExpiredAssetUploads(env) {
  const expired = rows(await env.DB.prepare(`
    SELECT id, asset_id, variant_label, upload_id, object_key
    FROM asset_uploads WHERE expires_at <= ?
  `).bind(nowIso()).all());
  for (const upload of expired) {
    if (env.BUCKET) {
      try { await env.BUCKET.resumeMultipartUpload(upload.object_key, upload.upload_id).abort(); }
      catch (error) { console.warn("Ignoring expired multipart abort", error); }
    }
    if (env.BUCKET) await env.BUCKET.delete(upload.object_key).catch(() => null);
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
  }
}

export async function deleteAssetObjects(env, assetId) {
  const asset = await env.DB.prepare("SELECT object_key, poster_object_key FROM assets WHERE id = ?").bind(assetId).first();
  if (!asset) throw new HttpError(404, "文件不存在");
  const [variants, uploads] = await Promise.all([
    env.DB.prepare("SELECT object_key FROM asset_variants WHERE asset_id = ?").bind(assetId).all(),
    env.DB.prepare("SELECT upload_id, object_key FROM asset_uploads WHERE asset_id = ?").bind(assetId).all(),
  ]);
  if (env.BUCKET) {
    for (const upload of rows(uploads)) {
      try { await env.BUCKET.resumeMultipartUpload(upload.object_key, upload.upload_id).abort(); }
      catch (error) { console.warn("Ignoring multipart abort during asset deletion", error); }
    }
    await env.BUCKET.delete([
      asset.object_key,
      ...(asset.poster_object_key ? [asset.poster_object_key] : []),
      ...rows(variants).map((item) => item.object_key),
    ]);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE asset_folders SET archive_asset_id = NULL WHERE archive_asset_id = ?").bind(assetId),
    env.DB.prepare(`
      DELETE FROM asset_upload_parts
      WHERE upload_session_id IN (SELECT id FROM asset_uploads WHERE asset_id = ?)
    `).bind(assetId),
    env.DB.prepare("DELETE FROM asset_uploads WHERE asset_id = ?").bind(assetId),
    env.DB.prepare("DELETE FROM asset_variants WHERE asset_id = ?").bind(assetId),
    env.DB.prepare("DELETE FROM asset_access_users WHERE asset_id = ?").bind(assetId),
    env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(assetId),
  ]);
}
