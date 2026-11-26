/** 文件资源文件夹的新增、移动和整包下载设置。 */
import { portfolioSectionRecord } from "../content/board-lookup.js";
import {
  attachAllowedUserIds,
  legacyAssetVisibility,
  normalizedVisibility,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "../content/visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

export async function adminAssetFolders(request, env, id) {
  if (request.method === "GET") {
    const items = rows(await env.DB.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM asset_folders child WHERE child.parent_id = f.id) AS folder_count,
        (SELECT COUNT(*) FROM assets a WHERE a.folder_id = f.id) AS asset_count
      FROM asset_folders f ORDER BY f.sort_order ASC, f.created_at ASC
    `).all());
    return attachAllowedUserIds(env, "assetFolder", items.map((item) => ({
      ...item,
      visibility: normalizedVisibility(item.access_mode || item.visibility),
    })));
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    const name = clampText(body.name, 120);
    const description = clampText(body.description, 800);
    const parentId = validId(body.parentId) ? String(body.parentId) : null;
    const oldFolder = id ? await env.DB.prepare("SELECT section_id FROM asset_folders WHERE id=?").bind(id).first() : null;
    const parentFolder = parentId ? await env.DB.prepare("SELECT section_id FROM asset_folders WHERE id=?").bind(parentId).first() : null;
    const sectionId = body.sectionId || parentFolder?.section_id || oldFolder?.section_id || RESOURCE_SECTION_ID;
    if ((await portfolioSectionRecord(env, sectionId)).kind !== "resources") throw new HttpError(400, "请选择文件与视频大板块");
    if (parentFolder && parentFolder.section_id !== sectionId) throw new HttpError(400, "文件夹必须属于同一大板块");
    if (oldFolder && oldFolder.section_id !== sectionId) throw new HttpError(409, "文件夹暂不支持跨大板块移动");
    const visibility = normalizedVisibility(body.visibility);
    const legacyVisibility = legacyAssetVisibility(visibility);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, body.allowedUserIds);
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
    const archiveAssetId = validId(body.archiveAssetId) ? String(body.archiveAssetId) : null;
    if (!name) throw new HttpError(400, "文件夹名称不能为空");
    if (parentId) {
      const parent = await env.DB.prepare("SELECT id FROM asset_folders WHERE id = ?").bind(parentId).first();
      if (!parent) throw new HttpError(400, "上级文件夹不存在");
      await validateChildAccessSubset(env, "assetFolder", parentId, visibility, allowedUserIds);
    } else {
      await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
    }
    if (archiveAssetId) {
      const archive = await env.DB.prepare(
        "SELECT id, kind FROM assets WHERE id = ? AND scope = 'library' AND section_id = ?",
      ).bind(archiveAssetId, sectionId).first();
      if (!archive || archive.kind !== "archive") throw new HttpError(400, "整包下载文件必须是已经上传的压缩包");
    }
    const timestamp = nowIso();
    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO asset_folders
          (id, section_id, parent_id, name, description, visibility, access_mode, sort_order, archive_asset_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newId, sectionId, parentId, name, description, legacyVisibility, visibility,
        sortOrder, archiveAssetId, timestamp, timestamp,
      ).run();
      await replaceAllowedUsers(env, "assetFolder", newId, allowedUserIds, timestamp);
      return { id: newId, allowed_user_ids: allowedUserIds };
    }

    if (!validId(id)) throw new HttpError(400, "文件夹 ID 错误");
    const existing = await env.DB.prepare("SELECT id FROM asset_folders WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "文件夹不存在");
    if (parentId === id) throw new HttpError(400, "文件夹不能作为自己的上级");
    let cursor = parentId;
    const visited = new Set();
    while (cursor) {
      if (cursor === id) throw new HttpError(400, "不能把文件夹移动到自己的下级");
      if (visited.has(cursor)) throw new HttpError(400, "目标文件夹层级存在循环");
      visited.add(cursor);
      const parent = await env.DB.prepare("SELECT parent_id FROM asset_folders WHERE id = ?").bind(cursor).first();
      cursor = parent?.parent_id || null;
    }
    await env.DB.prepare(`
      UPDATE asset_folders SET parent_id = ?, name = ?, description = ?, visibility = ?, access_mode = ?,
        sort_order = ?, archive_asset_id = ?, updated_at = ? WHERE id = ?
    `).bind(
      parentId, name, description, legacyVisibility, visibility,
      sortOrder, archiveAssetId, timestamp, id,
    ).run();
    await replaceAllowedUsers(env, "assetFolder", id, allowedUserIds, timestamp);
    return { id, allowed_user_ids: allowedUserIds };
  }

  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "文件夹 ID 错误");
    const counts = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM asset_folders WHERE parent_id = ?) AS folders,
        (SELECT COUNT(*) FROM assets WHERE folder_id = ?) AS assets
    `).bind(id, id).first();
    if (Number(counts?.folders) || Number(counts?.assets)) {
      throw new HttpError(409, "文件夹中仍有文件或子文件夹，请先移走或删除它们");
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM asset_folder_access_users WHERE folder_id = ?").bind(id),
      env.DB.prepare("DELETE FROM asset_folders WHERE id = ?").bind(id),
    ]);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
