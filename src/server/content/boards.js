/** 文章、图片和文件板块的层级、版式和 Studio 编辑。 */
import { deleteContentCascade } from "./article-attachments.js";
import { gallerySectionId, portfolioSectionRecord } from "./board-lookup.js";
import { presentationSettings } from "./presentation.js";
import {
  attachAllowedUserIds,
  normalizedDownloadPolicy,
  normalizedVisibility,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "./visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { deleteAssetObjects } from "../media/file-storage.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

/* ---------- 个人空间大板块：新增、改名、排序、删除。 ---------- */
function readPresentationSettings(input, current, inherit = false) {
  try { return presentationSettings(input, current, inherit); }
  catch (error) { throw new HttpError(400, error.message); }
}

async function renamePortfolioBoard(request, env, table, id) {
  if (!validId(id)) throw new HttpError(400, "板块 ID 错误");
  const input = await readJson(request);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) throw new HttpError(400, "板块名称需要 1–80 个字符");
  const result = await env.DB.prepare(`UPDATE ${table} SET name=?,updated_at=? WHERE id=? RETURNING id,name,updated_at`).bind(name, nowIso(), id).first();
  if (!result) throw new HttpError(404, "板块不存在");
  return result;
}

export async function adminSections(request, env, id) {
  if (request.method === "PATCH") return renamePortfolioBoard(request, env, "portfolio_sections", id);
  if (request.method === "GET") {
    const items = rows(await env.DB.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM content c WHERE c.section_id = s.id) AS content_count,
        (SELECT COUNT(*) FROM portfolio_subsections ss WHERE ss.section_id = s.id) AS subsection_count,
        (SELECT COUNT(*) FROM albums a WHERE a.section_id = s.id) AS album_count,
        (SELECT COUNT(*) FROM media m WHERE m.section_id = s.id AND m.kind = 'photo') AS media_count,
        (SELECT COUNT(*) FROM assets a WHERE a.section_id = s.id) AS resource_count
      FROM portfolio_sections s
      ORDER BY s.sort_order ASC, s.created_at ASC
    `).all());
    const withAccess = await attachAllowedUserIds(env, "section", items);
    return withAccess.map((item) => item.id === RESOURCE_SECTION_ID || item.category === "resources" ? { ...item, kind: "resources" } : item);
  }

  if (request.method === "POST" || request.method === "PUT") {
    const input = await readJson(request);
    const name = clampText(input.name, 80);
    const resourceSection = id === RESOURCE_SECTION_ID;
    const category = resourceSection || input.kind === "resources" ? "resources" : input.kind === "gallery" ? "gallery" : "content";
    const kind = resourceSection ? "content" : (input.kind === "gallery" ? "gallery" : "content");
    const description = clampText(input.description, 500);
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
    const showAll = input.showAll === true ? 1 : 0;
    const visibility = normalizedVisibility(input.visibility);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, input.allowedUserIds);
    if (!name) throw new HttpError(400, "板块名称不能为空");
    const timestamp = nowIso();
    const currentStyle = id ? await env.DB.prepare("SELECT article_layout, gallery_layout FROM portfolio_sections WHERE id=?").bind(id).first() : null;
    const layout = readPresentationSettings(input, currentStyle || {});

    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO portfolio_sections
          (id, name, kind, category, description, sort_order, show_all, visibility, article_layout, gallery_layout, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId, name, kind, category, description, sortOrder, showAll, visibility, layout.article_layout, layout.gallery_layout, timestamp, timestamp).run();
      await replaceAllowedUsers(env, "section", newId, allowedUserIds, timestamp);
      return { id: newId, allowed_user_ids: allowedUserIds };
    }

    if (!validId(id)) throw new HttpError(400, "板块 ID 错误");
    const existing = await env.DB.prepare("SELECT id, kind, category FROM portfolio_sections WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "板块不存在");
    if (existing.kind !== kind || (existing.category || (id === RESOURCE_SECTION_ID ? "resources" : existing.kind)) !== category) {
      const used = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM content WHERE section_id = ?) +
          (SELECT COUNT(*) FROM albums WHERE section_id = ?) +
          (SELECT COUNT(*) FROM media WHERE section_id = ?) +
          (SELECT COUNT(*) FROM assets WHERE section_id = ?) +
          (SELECT COUNT(*) FROM portfolio_subsections WHERE section_id = ?) AS count
      `).bind(id, id, id, id, id).first();
      if (Number(used?.count)) throw new HttpError(409, "板块内仍有内容，清空后才能更改板块类型");
    }
    await env.DB.prepare(`
      UPDATE portfolio_sections
      SET name = ?, kind = ?, category = ?, description = ?, sort_order = ?, show_all = ?, visibility = ?, article_layout = ?, gallery_layout = ?, updated_at = ?
      WHERE id = ?
    `).bind(name, kind, category, description, sortOrder, showAll, visibility, layout.article_layout, layout.gallery_layout, timestamp, id).run();
    await replaceAllowedUsers(env, "section", id, allowedUserIds, timestamp);
    return { id, allowed_user_ids: allowedUserIds };
  }

  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "板块 ID 错误");
    if (id === RESOURCE_SECTION_ID) throw new HttpError(409, "文件资源是固定板块，不能删除；可改为仅本人可见");
    const section = await env.DB.prepare("SELECT id FROM portfolio_sections WHERE id = ?").bind(id).first();
    if (!section) throw new HttpError(404, "板块不存在");

    const sectionContent = rows(await env.DB.prepare("SELECT id FROM content WHERE section_id = ?").bind(id).all());
    for (const item of sectionContent) await deleteContentCascade(env, item.id);

    const sectionMedia = rows(await env.DB.prepare(
      "SELECT id, object_key, preview_object_key FROM media WHERE section_id = ?",
    ).bind(id).all());
    const sectionAssets = rows(await env.DB.prepare(
      "SELECT id FROM assets WHERE section_id = ?",
    ).bind(id).all());
    for (const item of sectionAssets) await deleteAssetObjects(env, item.id);
    if (env.BUCKET) {
      for (const item of sectionMedia) {
        await env.BUCKET.delete(item.object_key);
        if (item.preview_object_key) await env.BUCKET.delete(item.preview_object_key);
      }
    }
    const statements = [];
    for (const item of sectionMedia) {
      statements.push(env.DB.prepare("UPDATE content SET cover_media_id = NULL WHERE cover_media_id = ?").bind(item.id));
      statements.push(env.DB.prepare("DELETE FROM media_access_users WHERE media_id = ?").bind(item.id));
    }
    statements.push(
      env.DB.prepare("DELETE FROM media WHERE section_id = ?").bind(id),
      env.DB.prepare("DELETE FROM albums WHERE section_id = ?").bind(id),
      env.DB.prepare("DELETE FROM portfolio_subsections WHERE section_id = ?").bind(id),
      env.DB.prepare("DELETE FROM section_access_users WHERE section_id = ?").bind(id),
      env.DB.prepare("DELETE FROM portfolio_sections WHERE id = ?").bind(id),
    );
    await env.DB.batch(statements);
    return { ok: true };
  }

  throw new HttpError(405, "不支持的请求方法");
}

export async function adminSubsections(request, env, id) {
  if (request.method === "PATCH") return renamePortfolioBoard(request, env, "portfolio_subsections", id);
  if (request.method === "GET") {
    const items = rows(await env.DB.prepare(`
      SELECT ss.*,
        (SELECT COUNT(*) FROM content c WHERE c.subsection_id = ss.id) AS content_count,
        (SELECT COUNT(*) FROM media m WHERE m.subsection_id = ss.id AND m.kind = 'photo') AS media_count,
        (SELECT COUNT(*) FROM assets a WHERE a.subsection_id = ss.id) AS asset_count
      FROM portfolio_subsections ss
      ORDER BY ss.sort_order ASC, ss.created_at ASC
    `).all());
    return attachAllowedUserIds(env, "subsection", items);
  }
  if (request.method === "POST" || request.method === "PUT") {
    const input = await readJson(request);
    const sectionId = (await portfolioSectionRecord(env, input.sectionId)).id;
    const current = id ? await env.DB.prepare("SELECT * FROM portfolio_subsections WHERE id=?").bind(id).first() : null;
    const parentId = Object.prototype.hasOwnProperty.call(input, "parentId") ? input.parentId || null : current?.parent_id || null;
    const layout = readPresentationSettings(input, current || {}, true);
    if (parentId !== null) {
      if (typeof parentId !== "string" || !validId(parentId) || parentId === id) throw new HttpError(400, "上级小板块无效");
      const parent = await env.DB.prepare("SELECT * FROM portfolio_subsections WHERE id=? AND section_id=?").bind(parentId, sectionId).first();
      if (!parent || parent.parent_id) throw new HttpError(400, "最多支持大板块、小板块、小小板块三级，请选择同一大板块下的小板块");
      if (id && await env.DB.prepare("SELECT id FROM portfolio_subsections WHERE parent_id=? LIMIT 1").bind(id).first()) throw new HttpError(409, "已有小小板块，不能再降低此板块的层级");
    }
    const name = clampText(input.name, 80);
    const description = clampText(input.description, 500);
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
    const visibility = normalizedVisibility(input.visibility);
    const requestedDownloadPolicy = Object.prototype.hasOwnProperty.call(input, "downloadPolicy")
      ? normalizedDownloadPolicy(input.downloadPolicy)
      : null;
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, input.allowedUserIds);
    await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
    if (parentId) await validateChildAccessSubset(env, "subsection", parentId, visibility, allowedUserIds);
    if (!name) throw new HttpError(400, "小板块名称不能为空");
    const timestamp = nowIso();
    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      const downloadPolicy = requestedDownloadPolicy || "public";
      await env.DB.prepare(`
        INSERT INTO portfolio_subsections
          (id, section_id, parent_id, name, description, sort_order, visibility, download_policy, article_layout, gallery_layout, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId, sectionId, parentId, name, description, sortOrder, visibility, downloadPolicy, layout.article_layout, layout.gallery_layout, timestamp, timestamp).run();
      await replaceAllowedUsers(env, "subsection", newId, allowedUserIds, timestamp);
      return { id: newId, allowed_user_ids: allowedUserIds };
    }
    if (!validId(id)) throw new HttpError(400, "小板块 ID 错误");
    const existing = await env.DB.prepare(
      "SELECT id, section_id, download_policy FROM portfolio_subsections WHERE id = ?",
    ).bind(id).first();
    if (!existing) throw new HttpError(404, "小板块不存在");
    const downloadPolicy = requestedDownloadPolicy || normalizedDownloadPolicy(existing.download_policy);
    if (existing.section_id !== sectionId) {
      if (await env.DB.prepare("SELECT id FROM portfolio_subsections WHERE parent_id=? LIMIT 1").bind(id).first()) throw new HttpError(409, "请先移动或删除下级板块");
      const usage = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM content WHERE subsection_id = ?) +
          (SELECT COUNT(*) FROM media WHERE subsection_id = ?) +
          (SELECT COUNT(*) FROM assets WHERE subsection_id = ?) AS count
      `).bind(id, id, id).first();
      if (Number(usage?.count)) throw new HttpError(409, "小板块中仍有内容或文件，清空后才能更换所属大板块");
    }
    await env.DB.prepare(`
      UPDATE portfolio_subsections
      SET section_id = ?, parent_id = ?, name = ?, description = ?, sort_order = ?, visibility = ?, download_policy = ?, article_layout = ?, gallery_layout = ?, updated_at = ?
      WHERE id = ?
    `).bind(sectionId, parentId, name, description, sortOrder, visibility, downloadPolicy, layout.article_layout, layout.gallery_layout, timestamp, id).run();
    await replaceAllowedUsers(env, "subsection", id, allowedUserIds, timestamp);
    return { id, allowed_user_ids: allowedUserIds };
  }
  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "小板块 ID 错误");
    if (await env.DB.prepare("SELECT id FROM portfolio_subsections WHERE parent_id=? LIMIT 1").bind(id).first()) throw new HttpError(409, "请先处理下属小小板块");
    await env.DB.batch([
      env.DB.prepare("UPDATE content SET subsection_id = NULL WHERE subsection_id = ?").bind(id),
      env.DB.prepare("UPDATE media SET subsection_id = NULL WHERE subsection_id = ?").bind(id),
      env.DB.prepare("UPDATE assets SET subsection_id = NULL WHERE subsection_id = ?").bind(id),
      env.DB.prepare("DELETE FROM subsection_access_users WHERE subsection_id = ?").bind(id),
      env.DB.prepare("DELETE FROM portfolio_subsections WHERE id = ?").bind(id),
    ]);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}

export async function adminAlbums(request, env, id) {
  if (request.method === "GET") {
    const items = rows(await env.DB.prepare(`
      SELECT a.*, COUNT(m.id) AS media_count
      FROM albums a LEFT JOIN media m ON m.album_id = a.id
      GROUP BY a.id ORDER BY a.sort_order ASC, a.created_at ASC
    `).all());
    return attachAllowedUserIds(env, "album", items);
  }
  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    const name = clampText(body.name, 80);
    const description = clampText(body.description, 500);
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
    const sectionId = await gallerySectionId(env, body.sectionId);
    const visibility = normalizedVisibility(body.visibility);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, body.allowedUserIds);
    await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
    if (!name) throw new HttpError(400, "相册名称不能为空");
    const timestamp = nowIso();
    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO albums (id, name, description, sort_order, created_at, updated_at, section_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId, name, description, sortOrder, timestamp, timestamp, sectionId, visibility).run();
      await replaceAllowedUsers(env, "album", newId, allowedUserIds, timestamp);
      return { id: newId, allowed_user_ids: allowedUserIds };
    }
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE albums SET name = ?, description = ?, sort_order = ?, section_id = ?, visibility = ?, updated_at = ? WHERE id = ?
      `).bind(name, description, sortOrder, sectionId, visibility, timestamp, id),
      env.DB.prepare("UPDATE media SET section_id = ?, updated_at = ? WHERE album_id = ?")
        .bind(sectionId, timestamp, id),
      env.DB.prepare("UPDATE assets SET section_id = ?, updated_at = ? WHERE album_id = ?")
        .bind(sectionId, timestamp, id),
    ]);
    await replaceAllowedUsers(env, "album", id, allowedUserIds, timestamp);
    return { id, allowed_user_ids: allowedUserIds };
  }
  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("UPDATE media SET album_id = NULL WHERE album_id = ?").bind(id),
      env.DB.prepare("UPDATE assets SET album_id = NULL WHERE album_id = ?").bind(id),
      env.DB.prepare("DELETE FROM album_access_users WHERE album_id = ?").bind(id),
      env.DB.prepare("DELETE FROM albums WHERE id = ?").bind(id),
    ]);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
