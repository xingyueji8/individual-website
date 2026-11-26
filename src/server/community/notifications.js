/** 站内通知和消息偏好。 */
import { requireAuthenticatedUser } from "../accounts/member-session.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

async function ensureNotificationPreferences(env, userId) {
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO notification_preferences
      (user_id, article_updates, auto_open_on_login, show_badge, updated_at)
    VALUES (?, 0, 0, 1, ?)
  `).bind(userId, timestamp).run();
  return env.DB.prepare(`
    SELECT article_updates, auto_open_on_login, show_badge, updated_at
    FROM notification_preferences WHERE user_id = ?
  `).bind(userId).first();
}

export async function createNotification(env, userId, {
  type = "system", title, body = "", targetUrl = "", actorUserId = null,
} = {}) {
  if (!validId(userId) || !clampText(title, 120)) return null;
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO notifications
      (id, user_id, type, title, body, target_url, actor_user_id, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).bind(
    id, userId, clampText(type, 40), clampText(title, 120), clampText(body, 1200),
    clampText(targetUrl, 500), validId(actorUserId) ? actorUserId : null, nowIso(),
  ).run();
  return id;
}

export async function notifyArticlePublished(env, contentId, title) {
  const subscribers = rows(await env.DB.prepare(`
    SELECT u.id FROM users u
    JOIN notification_preferences p ON p.user_id = u.id
    WHERE u.status = 'approved' AND p.article_updates = 1
  `).all());
  for (const subscriber of subscribers.slice(0, 1000)) {
    await createNotification(env, subscriber.id, {
      type: "article", title: "星月集发布了新文章", body: title,
      targetUrl: `/#article-${contentId}`,
    });
  }
}

export async function notificationInbox(request, env) {
  const user = await requireAuthenticatedUser(request, env);
  const preferences = await ensureNotificationPreferences(env, user.id);
  const result = await env.DB.prepare(`
    SELECT n.id, n.type, n.title, n.body, n.target_url, n.read_at, n.created_at,
           n.actor_user_id, u.nickname AS actor_nickname
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_user_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT 120
  `).bind(user.id).all();
  const items = rows(result);
  return {
    notifications: items,
    unreadCount: items.filter((item) => !item.read_at).length,
    preferences: {
      articleUpdates: Boolean(preferences?.article_updates),
      autoOpenOnLogin: Boolean(preferences?.auto_open_on_login),
      showBadge: preferences?.show_badge !== 0,
    },
  };
}

export async function updateNotification(request, env, id, action) {
  const user = await requireAuthenticatedUser(request, env);
  const timestamp = nowIso();
  if (action === "read-all" && request.method === "POST") {
    await env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ?")
      .bind(timestamp, user.id).run();
    return { ok: true };
  }
  if (!validId(id)) throw new HttpError(400, "通知 ID 错误");
  if (request.method === "PUT") {
    await env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?")
      .bind(timestamp, id, user.id).run();
    return { id, readAt: timestamp };
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?").bind(id, user.id).run();
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}

export async function notificationPreferences(request, env) {
  const user = await requireAuthenticatedUser(request, env);
  if (request.method === "GET") return ensureNotificationPreferences(env, user.id);
  if (request.method !== "PUT") throw new HttpError(405, "不支持的请求方法");
  const input = await readJson(request);
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO notification_preferences
      (user_id, article_updates, auto_open_on_login, show_badge, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      article_updates = excluded.article_updates,
      auto_open_on_login = excluded.auto_open_on_login,
      show_badge = excluded.show_badge,
      updated_at = excluded.updated_at
  `).bind(
    user.id, input.articleUpdates === true ? 1 : 0,
    input.autoOpenOnLogin === true ? 1 : 0, input.showBadge === false ? 0 : 1, timestamp,
  ).run();
  return { ok: true };
}
