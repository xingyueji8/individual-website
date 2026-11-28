/** 普通用户会话、用户摘要和登录事件记录。 */
import { HttpError } from "../http/responses.js";
import { randomToken, sha256 } from "../shared/crypto.js";
import { clientMeta, getCookie } from "../shared/request-meta.js";
import { clampText, nowIso } from "../shared/values.js";

export const USER_SESSION_COOKIE = "xyj_user";

const USER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const USER_SESSION_REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

export function userSessionCookie(_request, value, maxAge) {
  const hasLifetime = maxAge !== null && maxAge !== undefined && Number.isFinite(Number(maxAge));
  const lifetime = hasLifetime ? `; Max-Age=${Number(maxAge)}` : "";
  return `${USER_SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/${lifetime}`;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    status: user.status,
    role: user.role,
    createdAt: user.created_at,
    approvedAt: user.approved_at || null,
    lastLoginAt: user.last_login_at || null,
    passwordChangedAt: user.password_changed_at || null,
    fullAccess: user.status === "approved",
  };
}

export async function recordLoginEvent(env, request, eventType, userId = null, usernameAttempt = "") {
  const meta = await clientMeta(request);
  await env.DB.prepare(`
    INSERT INTO login_events
      (id, user_id, username_attempt, event_type, ip_hash, ip_hint, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), userId, clampText(usernameAttempt, 32), eventType,
    meta.ipHash, meta.ipHint, meta.userAgent, nowIso(),
  ).run();
}

export async function createUserSession(request, env, userId, remember = false, sourceSessionHash = "") {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const ttl = remember ? USER_SESSION_REMEMBER_TTL_SECONDS : USER_SESSION_TTL_SECONDS;
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const meta = await clientMeta(request);
  const fields = [tokenHash, userId, timestamp, timestamp, expiresAt, meta.ipHash, meta.ipHint, meta.userAgent];
  const guard = sourceSessionHash ? `WHERE EXISTS (
    SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      AND u.status <> 'disabled'
  )` : "";
  const inserted = await env.DB.prepare(`
    INSERT INTO user_sessions
      (token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at, ip_hash, ip_hint, user_agent)
    SELECT ?, ?, ?, ?, ?, NULL, ?, ?, ? ${guard}
  `).bind(...fields, ...(sourceSessionHash ? [sourceSessionHash, userId, timestamp] : [])).run();
  if (sourceSessionHash && inserted.meta?.changes !== 1) {
    throw new HttpError(401, "网站会话已失效，请重新确认登录");
  }
  // 未勾选“保持登录”时不写 Max-Age，浏览器关闭后 Cookie 随会话结束。
  return { token, ttl, cookieMaxAge: remember ? ttl : null };
}

export async function getUserSession(request, env, touch = true) {
  const token = getCookie(request, USER_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(`
    SELECT s.token_hash, s.created_at AS session_created_at, s.last_seen_at AS session_last_seen_at,
           s.expires_at, u.*
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `).bind(tokenHash, nowIso()).first();
  if (!session || session.status === "disabled") return null;

  if (touch && new Date(session.session_last_seen_at).getTime() < Date.now() - 45_000) {
    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(timestamp, tokenHash),
      env.DB.prepare("UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?")
        .bind(timestamp, timestamp, session.id),
    ]);
    session.session_last_seen_at = timestamp;
    session.last_seen_at = timestamp;
  }
  return session;
}

export async function requireApprovedUser(request, env) {
  const user = await getUserSession(request, env);
  if (!user) throw new HttpError(401, "请登录后使用 AI 助手");
  if (user.status !== "approved") throw new HttpError(403, "账号尚未通过审核，暂时不能使用完整功能");
  return user;
}

export async function requireAuthenticatedUser(request, env) {
  const user = await getUserSession(request, env);
  if (!user) throw new HttpError(401, "请先登录账号");
  return user;
}
