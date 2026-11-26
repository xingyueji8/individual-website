/** 正文插图、封面和附件归属及旧文章迁移。 */
import { deleteAssetObjects } from "../media/file-storage.js";
import { rows, validId } from "../shared/values.js";

export async function deleteContentCascade(env, id) {
  const articleAssets = rows(await env.DB.prepare(
    "SELECT id FROM assets WHERE scope = 'article' AND content_id = ?",
  ).bind(id).all());
  for (const asset of articleAssets) await deleteAssetObjects(env, asset.id);
  const commentIds = rows(await env.DB.prepare("SELECT id FROM comments WHERE content_id = ?").bind(id).all());
  const statements = [
    env.DB.prepare("DELETE FROM reactions WHERE target_type = 'content' AND target_id = ?").bind(id),
    env.DB.prepare("DELETE FROM content_access_users WHERE content_id = ?").bind(id),
    env.DB.prepare("DELETE FROM comments WHERE content_id = ?").bind(id),
    env.DB.prepare("DELETE FROM content WHERE id = ?").bind(id),
  ];
  for (const comment of commentIds) {
    statements.unshift(env.DB.prepare("DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ?").bind(comment.id));
  }
  await env.DB.batch(statements);
}

export function inlineMediaIdsFromHtml(html) {
  const ids = new Set();
  for (const match of String(html || "").matchAll(/\/media\/([a-zA-Z0-9_-]{1,80})/g)) ids.add(match[1]);
  return [...ids];
}

function embeddedAssetIdsFromHtml(html) {
  const ids = new Set();
  for (const match of String(html || "").matchAll(/<div\b([^>]*)>/gi)) {
    const attributes = match[1] || "";
    const type = attributes.match(/\bdata-resource-type\s*=\s*["']([^"']+)["']/i)?.[1];
    const id = attributes.match(/\bdata-resource-id\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type === "asset" && validId(id)) ids.add(id);
  }
  return [...ids];
}

async function moveLegacyAssetsIntoArticle(env, content, assetIds, timestamp) {
  if (!assetIds.length) return;
  const statements = assetIds.map((assetId) => env.DB.prepare(`
    UPDATE assets
    SET scope = 'article', folder_id = NULL, album_id = NULL, content_id = ?,
        section_id = ?, subsection_id = ?, updated_at = ?
    WHERE id = ?
      AND (COALESCE(scope, 'library') = 'library' OR (scope = 'article' AND content_id IS NULL))
  `).bind(
    content.id,
    content.section_id || (content.type === "guide" ? "section-guides" : "section-essays"),
    content.subsection_id || null,
    timestamp,
    assetId,
  ));
  for (let index = 0; index < statements.length; index += 40) {
    await env.DB.batch(statements.slice(index, index + 40));
  }
}

export async function migrateLegacyEmbeddedArticleAssets(env, timestamp) {
  const contentItems = rows(await env.DB.prepare(`
    SELECT id, type, section_id, subsection_id, body_html
    FROM content
    WHERE body_html LIKE '%data-resource-id=%'
    ORDER BY updated_at DESC, created_at DESC
  `).all());
  const claimedAssetIds = new Set();
  for (const content of contentItems) {
    const assetIds = embeddedAssetIdsFromHtml(content.body_html)
      .filter((assetId) => !claimedAssetIds.has(assetId));
    if (!assetIds.length) continue;
    assetIds.forEach((assetId) => claimedAssetIds.add(assetId));
    await moveLegacyAssetsIntoArticle(env, content, assetIds, timestamp);
  }
}

export async function syncEmbeddedArticleAssets(env, content, bodyHtml, timestamp) {
  await moveLegacyAssetsIntoArticle(env, content, embeddedAssetIdsFromHtml(bodyHtml), timestamp);
  await syncInlineMediaOwnership(env, content, bodyHtml);
}

async function syncInlineMediaOwnership(env, content, bodyHtml) {
  const ids = [...new Set([...inlineMediaIdsFromHtml(bodyHtml), ...(validId(content.cover_media_id) ? [content.cover_media_id] : [])])];
  if (!ids.length) return;
  await env.DB.prepare(`UPDATE media SET content_id=?,section_id=?,subsection_id=?
    WHERE kind='inline' AND id IN (SELECT value FROM json_each(?)) AND (content_id IS NULL OR content_id=?)`)
    .bind(content.id, content.section_id, content.subsection_id || null, JSON.stringify(ids), content.id).run();
}

export async function deleteRemovedArticleAssets(env, contentId, bodyHtml, requestedIds) {
  if (!Array.isArray(requestedIds)) return { deletedAssetIds: [], failedDeleteAssetIds: [] };
  const retainedIds = new Set(embeddedAssetIdsFromHtml(bodyHtml));
  const candidates = [...new Set(requestedIds.map(String).filter(validId))]
    .filter((assetId) => !retainedIds.has(assetId))
    .slice(0, 200);
  if (!candidates.length) return { deletedAssetIds: [], failedDeleteAssetIds: [] };

  /*
   * 浏览器只能请求删除当前文章真正拥有、且新正文已经不再引用的附件。
   * 即使有人手工伪造请求，也不能借此删除其他文章或其他板块的文件。
   */
  const result = await env.DB.prepare(`
    SELECT id FROM assets
    WHERE scope = 'article' AND content_id = ?
      AND id IN (SELECT value FROM json_each(?))
  `).bind(contentId, JSON.stringify(candidates)).all();
  const deletedAssetIds = [];
  const failedDeleteAssetIds = [];
  for (const item of rows(result)) {
    try {
      await deleteAssetObjects(env, item.id);
      deletedAssetIds.push(item.id);
    } catch (error) {
      console.error("Article attachment deletion failed", { contentId, assetId: item.id, error });
      failedDeleteAssetIds.push(item.id);
    }
  }
  return { deletedAssetIds, failedDeleteAssetIds };
}
