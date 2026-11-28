/** Issue a short-lived, one-use code from an explicitly authorized browser session. */
import { getGuestSession, guestSessionCookie } from "./guest-session.js";
import { createUserSession, requireAuthenticatedUser, userSessionCookie } from "./member-session.js";
import { readJson } from "../http/request.js";
import { HttpError, json, jsonWithCookies } from "../http/responses.js";
import { randomToken, sha256 } from "../shared/crypto.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { shareVisitorCookie } from "../shared/request-meta.js";
import { nowIso } from "../shared/values.js";

const TOKEN = /^[a-f0-9]{64}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;

export function androidAppLinks() {
  return json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "cn.com.xingyueji.offline",
      sha256_cert_fingerprints: ["9A:83:8B:25:0F:DA:55:28:0E:58:B5:B0:FB:9C:BE:F8:15:1F:A0:C8:86:23:B4:D9:AD:84:02:70:9F:7F:57:CE"],
    },
  }], 200, { "Cache-Control": "public, max-age=3600" });
}

export async function authorizeAndroidLogin(request, env) {
  if (request.headers.get("Origin") !== new URL(request.url).origin || await getGuestSession(request, env)) {
    throw new HttpError(403, "请在网站登录后确认授权");
  }
  const user = await requireAuthenticatedUser(request, env);
  await consumeRateLimit(env, `android-approve:${user.id}`, 8, 10 * 60);
  const { challenge } = await readJson(request);
  if (typeof challenge !== "string" || !TOKEN.test(challenge)) {
    throw new HttpError(400, "无效的 App 登录请求");
  }
  const code = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM android_login_codes WHERE expires_at <= ?").bind(nowIso()),
    env.DB.prepare(`INSERT INTO android_login_codes (code_hash, challenge, session_hash, user_id, expires_at)
      VALUES (?, ?, ?, ?, ?)`).bind(
      await sha256(code), challenge, user.token_hash, user.id, new Date(Date.now() + 120_000).toISOString(),
    ),
  ]);
  return json({ code });
}

export async function redeemAndroidLogin(request, env) {
  await consumeRateLimit(env, await clientRateKey(request, "android-login"), 20, 10 * 60);
  const { code, verifier } = await readJson(request);
  if (typeof code !== "string" || typeof verifier !== "string" || !CODE.test(code) || !TOKEN.test(verifier)) {
    throw new HttpError(400, "无效的 App 登录请求");
  }
  const grant = await env.DB.prepare(`DELETE FROM android_login_codes
    WHERE code_hash = ? AND challenge = ? AND expires_at > ?
    RETURNING session_hash, user_id`).bind(await sha256(code), await sha256(verifier), nowIso()).first();
  if (!grant) throw new HttpError(401, "授权已用过或超时，请重新确认登录");

  const session = await createUserSession(request, env, grant.user_id, true, grant.session_hash);
  return jsonWithCookies({ ok: true }, 200, [
    userSessionCookie(request, session.token, session.cookieMaxAge),
    guestSessionCookie(request, "", 0),
    shareVisitorCookie("", 0),
  ]);
}
