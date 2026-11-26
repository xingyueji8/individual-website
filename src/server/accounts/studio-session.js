/** Studio 管理员登录、Access 校验、会话签发和撤销。 */
import { verifiedAccessEmail } from "./access-token.js";
import { guestSessionCookie } from "./guest-session.js";
import { readJson } from "../http/request.js";
import { HttpError, jsonWithCookies } from "../http/responses.js";
import { randomToken, sha256, timingSafeEqualText } from "../shared/crypto.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { clientMeta, getCookie, shareVisitorCookie } from "../shared/request-meta.js";
import { clampText, nowIso } from "../shared/values.js";

const SESSION_COOKIE = "xyj_admin";

const SESSION_TTL_SECONDS = 60 * 60 * 12;

const ADMIN_SESSION_TOUCH_SECONDS = 5 * 60;

function configuredAdminAccessEmails(env) {
  return new Set(String(env?.ADMIN_ACCESS_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

async function adminAccessEmail(request, env, { required = false } = {}) {
  const allowed = configuredAdminAccessEmails(env);
  const issuer = String(env.ADMIN_ACCESS_TEAM_DOMAIN || "").trim();
  const audience = String(env.ADMIN_ACCESS_AUD || "").trim();
  if (!allowed.size && !issuer && !audience) return "";
  if (!allowed.size || !issuer || !audience) {
    if (required) throw new HttpError(503, "后台 Cloudflare Access 配置不完整，请站长检查邮箱、团队域名和应用 AUD");
    return null;
  }
  const email = await verifiedAccessEmail(request.headers.get("Cf-Access-Jwt-Assertion"), issuer, audience);
  if (!email || !allowed.has(email)) {
    if (required) throw new HttpError(403, "后台身份未通过 Cloudflare Access 验证");
    return null;
  }
  return email;
}

function adminSessionTtl(env) {
  const configured = Number.parseInt(env?.ADMIN_SESSION_TTL_SECONDS || "", 10);
  return Number.isFinite(configured)
    ? Math.max(15 * 60, Math.min(7 * 24 * 60 * 60, configured))
    : SESSION_TTL_SECONDS;
}

async function makeSession(request, env, accessEmail = "") {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const timestamp = nowIso();
  const ttl = adminSessionTtl(env);
  const meta = await clientMeta(request);
  await env.DB.prepare(`
    INSERT INTO admin_sessions
      (token_hash, access_email, created_at, last_seen_at, expires_at, revoked_at, ip_hash, user_agent)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).bind(
    tokenHash,
    accessEmail,
    timestamp,
    timestamp,
    new Date(Date.now() + ttl * 1000).toISOString(),
    meta.ipHash,
    meta.userAgent,
  ).run();
  return { token, ttl };
}

export async function isAdmin(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!env.DB || !/^[a-zA-Z0-9_-]{32,200}$/.test(token)) return false;
  const accessEmail = await adminAccessEmail(request, env);
  if (accessEmail === null) return false;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(`
    SELECT token_hash, access_email, last_seen_at, expires_at, revoked_at, user_agent
    FROM admin_sessions WHERE token_hash = ?
  `).bind(tokenHash).first();
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return false;
  if (session.access_email && session.access_email !== accessEmail) return false;
  const userAgent = clampText(request.headers.get("User-Agent"), 300);
  if (session.user_agent && session.user_agent !== userAgent) return false;

  if (Date.now() - Date.parse(session.last_seen_at) >= ADMIN_SESSION_TOUCH_SECONDS * 1000) {
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(nowIso(), tokenHash).run();
  }
  return true;
}

export async function revokeAdminSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!env.DB || !/^[a-zA-Z0-9_-]{32,200}$/.test(token)) return;
  await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(nowIso(), await sha256(token)).run();
}

export function secureCookie(_request, value, maxAge) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, "请先在 Cloudflare 中配置 ADMIN_PASSWORD");
  const accessEmail = await adminAccessEmail(request, env, { required: true });
  await consumeRateLimit(env, await clientRateKey(request, "admin-login"), 8, 15 * 60);
  const body = await readJson(request);
  if (!(await timingSafeEqualText(body.password || "", env.ADMIN_PASSWORD))) {
    throw new HttpError(401, "密码错误");
  }
  const session = await makeSession(request, env, accessEmail);
  return jsonWithCookies({ ok: true }, 200, [
    secureCookie(request, session.token, session.ttl),
    guestSessionCookie(request, "", 0),
    shareVisitorCookie("", 0),
  ]);
}
