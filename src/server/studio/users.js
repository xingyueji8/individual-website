/** Studio 账号审核、备注、状态和登录事件。 */
import { createNotification } from "../community/notifications.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clampMultilineText, clampText, nowIso, rows, validId } from "../shared/values.js";

/*
 * Studio 用户管理接口不会 SELECT 或返回 password_hash/password_salt。
 * 站长可以审核、停用、查看在线状态与登录痕迹，但永远不能读取用户密码。
 */
export async function adminUsers(request, env, id) {
  if (request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT u.id, u.username, u.nickname, u.status, u.role, u.created_at, u.updated_at,
             u.approved_at, u.last_login_at, u.last_seen_at, u.password_changed_at,
             p.display_name, p.contact_type, p.contact_value, p.note, p.invite_code, p.review_note, p.admin_note,
             MAX(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? THEN s.last_seen_at ELSE NULL END) AS active_session_seen_at,
             SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? THEN 1 ELSE 0 END) AS active_session_count
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN user_sessions s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY CASE u.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
               u.created_at DESC
    `).bind(nowIso(), nowIso()).all();
    const onlineCutoff = Date.now() - 2 * 60 * 1000;
    return rows(result).map((item) => ({
      ...item,
      active_session_count: Number(item.active_session_count || 0),
      is_online: Boolean(item.active_session_seen_at && new Date(item.active_session_seen_at).getTime() >= onlineCutoff),
    }));
  }

  if (request.method === "PUT") {
    if (!validId(id)) throw new HttpError(400, "用户 ID 错误");
    const input = await readJson(request);
    const existing = await env.DB.prepare(`
      SELECT u.id, u.status, p.review_note, p.admin_note
      FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?
    `).bind(id).first();
    if (!existing) throw new HttpError(404, "用户不存在");
    const status = ["pending", "approved", "rejected", "disabled"].includes(input.status)
      ? input.status
      : existing.status;
    const reviewNote = Object.prototype.hasOwnProperty.call(input, "reviewNote")
      ? clampText(input.reviewNote, 800)
      : (existing.review_note || "");
    const adminNote = Object.prototype.hasOwnProperty.call(input, "adminNote")
      ? clampMultilineText(input.adminNote, 1200)
      : (existing.admin_note || "");
    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users
        SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END,
            updated_at = ?
        WHERE id = ?
      `).bind(status, status, timestamp, timestamp, id),
      env.DB.prepare("UPDATE user_profiles SET review_note = ?, admin_note = ?, updated_at = ? WHERE user_id = ?")
        .bind(reviewNote, adminNote, timestamp, id),
    ]);
    if (status !== existing.status) {
      const statusText = { approved: "账号审核已通过", rejected: "账号审核未通过", disabled: "账号已停用", pending: "账号状态已改为待审核" }[status];
      await createNotification(env, id, {
        type: "account", title: statusText || "账号状态已更新",
        body: reviewNote || "你可以在账户设置中查看当前状态。", targetUrl: "/#settings",
      });
    }
    if (status === "disabled") {
      await env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(timestamp, id).run();
    }
    return { id, status, review_note: reviewNote, admin_note: adminNote };
  }

  throw new HttpError(405, "不支持的请求方法");
}

export async function adminUserEvents(request, env, id, url) {
  if (request.method !== "GET") throw new HttpError(405, "不支持的请求方法");
  if (id && !validId(id)) throw new HttpError(400, "用户 ID 错误");
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit")) || 80));
  const result = id
    ? await env.DB.prepare(`
        SELECT id, user_id, username_attempt, event_type, ip_hint, user_agent, created_at
        FROM login_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).bind(id, limit).all()
    : await env.DB.prepare(`
        SELECT id, user_id, username_attempt, event_type, ip_hint, user_agent, created_at
        FROM login_events ORDER BY created_at DESC LIMIT ?
      `).bind(limit).all();
  return rows(result);
}
