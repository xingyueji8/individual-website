/** 游客 Cookie、签名、有效期和身份恢复。 */
import { HttpError } from "../http/responses.js";
import { decodeBase64Url, encodeBase64Url, hmac, timingSafeEqualText } from "../shared/crypto.js";
import { getCookie } from "../shared/request-meta.js";

const GUEST_SESSION_COOKIE = "xyj_guest";

export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24;

function guestSessionSecret(env) {
  const secret = String(env.SESSION_SECRET || env.ADMIN_PASSWORD || "").trim();
  if (!secret) throw new HttpError(503, "游客会话密钥尚未配置，请先设置 SESSION_SECRET 或 ADMIN_PASSWORD");
  return secret;
}

export async function guestVisitorHash(env, visitorId) {
  return hmac(`guest-visitor:${visitorId}`, guestSessionSecret(env));
}

export async function makeGuestSession(env, visitorHash) {
  const payload = encodeBase64Url(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + GUEST_SESSION_TTL_SECONDS,
    visitorHash,
    nonce: crypto.randomUUID(),
  }));
  return `${payload}.${await hmac(payload, guestSessionSecret(env))}`;
}

export function guestSessionCookie(_request, value, maxAge) {
  return `${GUEST_SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function getGuestSession(request, env) {
  const token = getCookie(request, GUEST_SESSION_COOKIE);
  if (!token || !token.includes(".")) return null;
  const secret = String(env.SESSION_SECRET || env.ADMIN_PASSWORD || "").trim();
  if (!secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !(await timingSafeEqualText(await hmac(payload, secret), signature))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (Number(parsed.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (!/^[a-zA-Z0-9_-]{20,160}$/.test(String(parsed.visitorHash || ""))) return null;
    return { visitorHash: parsed.visitorHash, expiresAt: Number(parsed.exp) };
  } catch {
    return null;
  }
}

export async function requireGuestSession(request, env) {
  const session = await getGuestSession(request, env);
  if (!session) throw new HttpError(401, "请先完成游客验证，或登录账号后继续访问");
  return session;
}
