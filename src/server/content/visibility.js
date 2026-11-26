/** 可见性级别、授权名单和父级约束。 */
import { HttpError } from "../http/responses.js";
import { nowIso, rows, validId } from "../shared/values.js";

/*
 * 全站内容统一使用五级可见范围：
 * public  = 游客与用户均可访问；member = 所有审核通过的用户；
 * selected = 仅白名单用户；excluded = 除黑名单外均可访问；
 * private = 仅站长本人及 Studio。
 * 所有未知值都回退到 public，避免旧版本或手工请求写入无法判断的状态。
 */
export function normalizedVisibility(value) {
  return ["member", "selected", "excluded", "private"].includes(value) ? value : "public";
}

/*
 * 旧 assets / asset_folders 表的 visibility 字段带三级 CHECK 约束，不能直接
 * 写入 selected / excluded。新版本把完整五级权限保存在 access_mode，旧字段
 * 只作为兼容镜像；这样生产 D1 无需破坏性重建表。
 */
export function legacyAssetVisibility(value) {
  const mode = normalizedVisibility(value);
  return mode === "member" ? "member" : (mode === "private" ? "private" : "public");
}

export function normalizedDownloadPolicy(value) {
  return value === "public" ? "public" : "member";
}

export function visibleToWebsite(visibility, fullAccess, selectedAccess = false, ownerAccess = false) {
  const mode = normalizedVisibility(visibility);
  return mode === "public"
    || (mode === "member" && fullAccess)
    || (mode === "selected" && fullAccess && selectedAccess)
    || (mode === "excluded" && !selectedAccess)
    || (mode === "private" && ownerAccess);
}

/*
 * “仅指定用户”采用两张白名单关联表。前端传来的用户 ID 必须去重、限制数量，
 * 并再次确认账号已经审核通过；不能因为 Studio 下拉框正常就信任请求数据。
 */
export const ACCESS_TABLES = Object.freeze({
  content: { table: "content_access_users", targetColumn: "content_id" },
  media: { table: "media_access_users", targetColumn: "media_id" },
  section: { table: "section_access_users", targetColumn: "section_id" },
  subsection: { table: "subsection_access_users", targetColumn: "subsection_id" },
  album: { table: "album_access_users", targetColumn: "album_id" },
  assetFolder: { table: "asset_folder_access_users", targetColumn: "folder_id" },
  asset: { table: "asset_access_users", targetColumn: "asset_id" },
  profile: { table: "profile_section_access_users", targetColumn: "section_key" },
});

function normalizedAllowedUserIds(value) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  return [...new Set(source.map((item) => String(item || "")).filter(validId))].slice(0, 200);
}

export async function validatedAllowedUserIds(env, visibility, value) {
  if (!["selected", "excluded"].includes(visibility)) return [];
  const ids = normalizedAllowedUserIds(value);
  if (!ids.length) {
    throw new HttpError(400, visibility === "selected"
      ? "选择‘仅指定用户’时，请至少勾选一个已审核账号"
      : "选择‘不给指定用户看’时，请至少勾选一个已审核账号");
  }
  const result = await env.DB.prepare(
    "SELECT id FROM users WHERE status = 'approved' AND id IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(ids)).all();
  const approved = new Set(rows(result).map((item) => item.id));
  if (approved.size !== ids.length) throw new HttpError(400, "指定用户中包含未审核或不存在的账号，请刷新用户列表后重试");
  return ids;
}

export async function replaceAllowedUsers(env, kind, targetId, userIds, timestamp = nowIso()) {
  const config = ACCESS_TABLES[kind];
  if (!config) throw new Error("Unknown access table kind");
  const statements = [
    env.DB.prepare(`DELETE FROM ${config.table} WHERE ${config.targetColumn} = ?`).bind(targetId),
  ];
  if (userIds.length) {
    statements.push(env.DB.prepare(`
      INSERT INTO ${config.table} (${config.targetColumn}, user_id, created_at)
      SELECT ?, users.id, ?
      FROM users
      WHERE users.status = 'approved'
        AND users.id IN (SELECT value FROM json_each(?))
    `).bind(targetId, timestamp, JSON.stringify(userIds)));
  }
  await env.DB.batch(statements);
}

export async function attachAllowedUserIds(env, kind, items) {
  const config = ACCESS_TABLES[kind];
  if (!config || !items.length) return items;
  const result = await env.DB.prepare(
    `SELECT ${config.targetColumn} AS target_id, user_id FROM ${config.table}`,
  ).all();
  const byTarget = new Map();
  for (const row of rows(result)) {
    if (!byTarget.has(row.target_id)) byTarget.set(row.target_id, []);
    byTarget.get(row.target_id).push(row.user_id);
  }
  return items.map((item) => ({ ...item, allowed_user_ids: byTarget.get(item.id) || [] }));
}

async function userHasSelectedAccess(env, kind, targetId, userId) {
  const config = ACCESS_TABLES[kind];
  if (!config || !validId(targetId) || !validId(userId)) return false;
  const match = await env.DB.prepare(`
    SELECT 1 AS allowed FROM ${config.table}
    WHERE ${config.targetColumn} = ? AND user_id = ?
  `).bind(targetId, userId).first();
  return Boolean(match);
}

export async function canAccessTarget(env, kind, targetId, visibility, context) {
  const mode = normalizedVisibility(visibility);
  if (context.adminAccess) return true;
  const listed = context.user?.id
    ? await userHasSelectedAccess(env, kind, targetId, context.user.id)
    : false;
  return visibleToWebsite(mode, context.fullAccess, listed, context.ownerAccess);
}

export async function validateChildAccessSubset(env, parentKind, parentId, childVisibility, childUserIds) {
  if (childVisibility !== "selected") return;
  const config = ACCESS_TABLES[parentKind];
  if (!config || !validId(parentId)) return;
  const tableByKind = {
    content: "content",
    section: "portfolio_sections",
    subsection: "portfolio_subsections",
    album: "albums",
    assetFolder: "asset_folders",
  };
  const visibilityExpression = parentKind === "assetFolder" ? "COALESCE(access_mode, visibility)" : "visibility";
  const parent = await env.DB.prepare(`SELECT ${visibilityExpression} AS visibility FROM ${tableByKind[parentKind]} WHERE id = ?`)
    .bind(parentId).first();
  if (!parent) throw new HttpError(400, "所属上级板块不存在");
  const parentMode = normalizedVisibility(parent.visibility);
  if (parentMode === "private") throw new HttpError(400, "仅本人可见的上级板块不能包含指定用户可见的子板块");
  if (!["selected", "excluded"].includes(parentMode)) return;
  const result = await env.DB.prepare(
    `SELECT user_id FROM ${config.table} WHERE ${config.targetColumn} = ?`,
  ).bind(parentId).all();
  const parentUsers = new Set(rows(result).map((item) => item.user_id));
  const invalid = parentMode === "selected"
    ? childUserIds.some((userId) => !parentUsers.has(userId))
    : childUserIds.some((userId) => parentUsers.has(userId));
  if (invalid) throw new HttpError(400, "子板块的指定用户必须属于上级板块实际可见用户的子集");
}

/*
 * 文件夹的权限会沿父级向下继承：即使子文件夹误设为 public，只要任意父级为
 * member/private，游客也看不到它。这里一次构建 Map 并带循环保护，避免每条
 * 文件记录额外查询 D1，也避免错误的 parent_id 导致死循环。
 */
export function visibleAssetFolderIds(folderRows, context, listedFolderIds = new Set()) {
  const folderMap = new Map(folderRows.map((item) => [item.id, item]));
  const memo = new Map();
  const canSee = (id, trail = new Set()) => {
    if (!id) return true;
    if (memo.has(id)) return memo.get(id);
    const folder = folderMap.get(id);
    if (!folder || trail.has(id)) return false;
    const visibility = normalizedVisibility(folder.access_mode || folder.visibility);
    if (!context.adminAccess && !visibleToWebsite(
      visibility,
      context.fullAccess,
      listedFolderIds.has(folder.id),
      context.ownerAccess,
    )) {
      memo.set(id, false);
      return false;
    }
    trail.add(id);
    const result = canSee(folder.parent_id, trail);
    trail.delete(id);
    memo.set(id, result);
    return result;
  };
  return new Set(folderRows.filter((item) => canSee(item.id)).map((item) => item.id));
}
