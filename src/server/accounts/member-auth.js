/** 普通用户注册、登录、退出、资料和修改密码。 */
import { getGuestSession, guestSessionCookie } from "./guest-session.js";
import {
  createUserSession,
  getUserSession,
  publicUser,
  recordLoginEvent,
  USER_SESSION_COOKIE,
  userSessionCookie,
} from "./member-session.js";
import { createPasswordRecord, validatePassword, verifyPassword } from "./passwords.js";
import { verifyGuestTurnstile } from "./turnstile.js";
import { createNotification } from "../community/notifications.js";
import { readJson } from "../http/request.js";
import { HttpError, json, jsonWithCookies } from "../http/responses.js";
import { notifyRegistration } from "../integrations/outbound-notices.js";
import { sha256 } from "../shared/crypto.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { getCookie, shareVisitorCookie } from "../shared/request-meta.js";
import { clampText, nowIso } from "../shared/values.js";

export function normalizeUsername(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9_.-]{3,31}$/.test(username)) {
    throw new HttpError(400, "登录用户名须为 4—32 位字母、数字、下划线、点或短横线");
  }
  return username;
}

export function normalizeContact(type, value) {
  const contact = clampText(value, 160).normalize("NFKC");
  if (type === "qq" || type === "phone") return contact.replace(/[\s()-]/g, "");
  if (type === "email") return contact.toLowerCase();
  return contact.toLowerCase().replace(/\s+/g, " ");
}

export function contactType(value) {
  return ["qq", "wechat", "email", "phone", "other"].includes(value) ? value : "other";
}

export async function registerUser(request, env, ctx) {
  await consumeRateLimit(env, await clientRateKey(request, "user-register"), 5, 60 * 60);
  const input = await readJson(request);
  const username = validateUsername(input.username);
  const nickname = clampText(input.nickname, 30);
  const password = validatePassword(input.password);
  const displayName = clampText(input.displayName, 60);
  const type = contactType(input.contactType);
  const contact = clampText(input.contact, 160);
  const note = clampText(input.note, 800);
  const inviteCode = clampText(input.inviteCode, 80);
  if (!nickname) throw new HttpError(400, "请填写昵称");
  if (!displayName) throw new HttpError(400, "请填写真实姓名或常用昵称");

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username_normalized = ?")
    .bind(username).first();
  if (existing) throw new HttpError(409, "该登录用户名已被使用");

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  let passwordRecord;
  try {
    passwordRecord = await createPasswordRecord(password);
  } catch (error) {
    console.error("Registration password hashing failed", error);
    throw new HttpError(503, "密码安全处理暂时繁忙，请稍后重新提交");
  }
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users
          (id, username, username_normalized, nickname, password_hash, password_salt,
           password_iterations, status, role, created_at, updated_at, password_changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'member', ?, ?, ?)
      `).bind(
        id, username, username, nickname, passwordRecord.hash, passwordRecord.salt,
        passwordRecord.iterations, timestamp, timestamp, timestamp,
      ),
      env.DB.prepare(`
        INSERT INTO user_profiles
          (user_id, display_name, contact_type, contact_value, note, invite_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, displayName, type, contact, note, inviteCode, timestamp, timestamp),
    ]);
  } catch (error) {
    if (/unique/i.test(String(error?.message || error))) throw new HttpError(409, "该登录用户名已被使用");
    console.error("Registration database write failed", error);
    throw new HttpError(503, "注册资料暂时无法保存，请稍后重新提交");
  }

  /*
   * 账号及审核资料保存成功就是注册成功。访问日志或自动登录会话属于附加步骤，
   * 单项异常只写入日志，不再让用户看到笼统的“服务器处理请求时发生错误”。
   */
  await recordLoginEvent(env, request, "register", id, username)
    .catch((error) => console.error("Registration event logging failed", error));
  const session = await createUserSession(request, env, id, false)
    .catch((error) => {
      console.error("Registration session creation failed", error);
      return null;
    });
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  const noticeJob = notifyRegistration(env, {
    id, username, nickname, displayName, contactType: type, contact,
    note, inviteCode, createdAt: timestamp,
  }).catch((error) => console.error("Registration notification failed", error));
  if (ctx) ctx.waitUntil(noticeJob); else await noticeJob;
  return jsonWithCookies({ ok: true, user: publicUser(user), authenticated: Boolean(session) }, 201, [
    session ? userSessionCookie(request, session.token, session.cookieMaxAge) : "",
    guestSessionCookie(request, "", 0),
    shareVisitorCookie("", 0),
  ]);
}

export async function loginUser(request, env) {
  await consumeRateLimit(env, await clientRateKey(request, "user-login"), 10, 15 * 60);
  const input = await readJson(request);
  // 与游客入口共用同一个可见验证组件；已配置 Turnstile 时登录也必须验证。
  await verifyGuestTurnstile(request, env, input.turnstileToken);
  const username = normalizeUsername(input.username);
  const user = username
    ? await env.DB.prepare("SELECT * FROM users WHERE username_normalized = ?").bind(username).first()
    : null;

  if (!user || !(await verifyPassword(input.password, user))) {
    await recordLoginEvent(env, request, "login_failed", user?.id || null, username);
    throw new HttpError(401, "用户名或密码错误");
  }
  if (user.status === "disabled") {
    await recordLoginEvent(env, request, "login_blocked", user.id, username);
    throw new HttpError(403, "该账号已被停用，请联系站长");
  }

  const timestamp = nowIso();
  const session = await createUserSession(request, env, user.id, input.remember === true);
  await env.DB.prepare("UPDATE users SET last_login_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(timestamp, timestamp, timestamp, user.id).run();
  user.last_login_at = timestamp;
  user.last_seen_at = timestamp;
  await recordLoginEvent(env, request, "login_success", user.id, username);
  return jsonWithCookies({ ok: true, user: publicUser(user) }, 200, [
    userSessionCookie(request, session.token, session.cookieMaxAge),
    guestSessionCookie(request, "", 0),
    shareVisitorCookie("", 0),
  ]);
}

export async function authSession(request, env) {
  // 与 bootstrap 使用相同身份决策，游客模式下前端也必须立即呈现未登录状态。
  const user = (await getGuestSession(request, env)) ? null : await getUserSession(request, env);
  return json({
    authenticated: Boolean(user),
    user: user ? publicUser(user) : null,
    ...(user ? { expiresAt: user.expires_at } : {}),
  }, 200, { "Cache-Control": "no-store" });
}

export async function logoutUser(request, env) {
  const token = getCookie(request, USER_SESSION_COOKIE);
  const user = await getUserSession(request, env, false);
  if (token) {
    await env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(nowIso(), await sha256(token)).run();
  }
  if (user) await recordLoginEvent(env, request, "logout", user.id, user.username_normalized);
  return json({ ok: true }, 200, {
    "Set-Cookie": userSessionCookie(request, "", 0),
    "Cache-Control": "no-store",
  });
}

export async function updateUserProfile(request, env) {
  const user = await getUserSession(request, env);
  if (!user) throw new HttpError(401, "请先登录");
  const input = await readJson(request);
  const nickname = clampText(input.nickname, 30);
  if (!nickname) throw new HttpError(400, "昵称不能为空");
  const previousNickname = user.nickname;
  await env.DB.prepare("UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?")
    .bind(nickname, nowIso(), user.id).run();
  user.nickname = nickname;
  if (nickname !== previousNickname) {
    await createNotification(env, user.id, {
      type: "account", title: "昵称修改成功",
      body: `昵称已由“${previousNickname}”修改为“${nickname}”。`, targetUrl: "/#settings",
    });
  }
  return { user: publicUser(user) };
}

export async function changeUserPassword(request, env) {
  const user = await getUserSession(request, env);
  if (!user) throw new HttpError(401, "请先登录");
  const input = await readJson(request);
  if (!(await verifyPassword(input.currentPassword, user))) throw new HttpError(401, "当前密码错误");
  const newPassword = validatePassword(input.newPassword, "新密码");
  const record = await createPasswordRecord(newPassword);
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
                       password_changed_at = ?, updated_at = ? WHERE id = ?
    `).bind(record.hash, record.salt, record.iterations, timestamp, timestamp, user.id),
    env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(timestamp, user.id),
    env.DB.prepare(`UPDATE password_reset_requests SET status='expired', token_hash=NULL
      WHERE user_id=? AND status IN ('pending','approved')`).bind(user.id),
  ]);
  const remember = Date.parse(user.expires_at) - Date.parse(user.session_created_at) > 7 * 24 * 60 * 60 * 1000;
  const session = await createUserSession(request, env, user.id, remember);
  await recordLoginEvent(env, request, "password_change", user.id, user.username_normalized);
  await createNotification(env, user.id, {
    type: "account", title: "密码修改成功",
    body: "你的登录密码刚刚完成修改。如非本人操作，请立即联系站长。", targetUrl: "/#settings",
  });
  return json({ ok: true }, 200, {
    "Set-Cookie": userSessionCookie(request, session.token, session.cookieMaxAge),
    "Cache-Control": "no-store",
  });
}
