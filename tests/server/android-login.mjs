import assert from "node:assert/strict";
import { localWorker } from "../support/local-worker.mjs";
import { sha256 } from "../../src/server/shared/crypto.js";

const origin = "http://localhost";
const worker = localWorker({ bindings: {
  TURNSTILE_SITE_KEY: "local-test-site-key",
  TURNSTILE_SECRET_KEY: "local-test-secret",
} });
const password = "LocalTestPass123";
const verifier = "a".repeat(64);
const challenge = await sha256(verifier);
const post = (path, body, cookie = "", requestOrigin = origin) => worker.dispatchFetch(origin + path, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie, Origin: requestOrigin },
  body: JSON.stringify(body),
});
const userCookie = response => {
  const header = response.headers.getSetCookie().find(value => value.startsWith("xyj_user="));
  assert.ok(header?.includes("HttpOnly") && header.includes("Secure"));
  return header.split(";")[0];
};

try {
  const registered = await post("/api/auth/register", {
    username: "android-tester", nickname: "Android fixture", displayName: "Tester", password,
  });
  assert.equal(registered.status, 201);
  const browser = userCookie(registered);
  const authorization = "/api/auth/app/authorize";
  const redemption = "/api/auth/app/redeem";
  assert.equal((await post(authorization, { challenge })).status, 401);
  assert.equal((await post(authorization, { challenge }, browser, "https://another.example")).status, 403);
  assert.notEqual((await post("/api/auth/login", { username: "android-tester", password })).status, 200);

  async function issue() {
    const response = await post(authorization, { challenge }, browser);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const { code } = await response.json();
    return code;
  }
  const code = await issue();
  assert.equal((await post(redemption, { code, verifier: "b".repeat(64) })).status, 401);
  const redeemed = await Promise.all([post(redemption, { code, verifier }), post(redemption, { code, verifier })]);
  assert.deepEqual(redeemed.map(response => response.status).sort(), [200, 401]);
  const appLogin = redeemed.find(response => response.ok);
  assert.match(appLogin.headers.get("Set-Cookie"), /Max-Age=2592000/);
  const app = userCookie(appLogin);
  assert.notEqual(app, browser);
  const session = async () => (await worker.dispatchFetch(origin + "/api/auth/session", {
    headers: { Cookie: app },
  })).json();
  const fresh = await session();
  assert.equal(fresh.user.username, "android-tester");
  assert.equal(fresh.user.status, "pending");
  assert.ok(Date.parse(fresh.expiresAt) > Date.now());
  assert.doesNotMatch(JSON.stringify(fresh), /password_hash|password_salt|LocalTestPass/);

  const expiredCode = await issue();
  const db = await worker.getD1Database("DB");
  await db.prepare("UPDATE android_login_codes SET expires_at = ?").bind("2000-01-01T00:00:00Z").run();
  assert.equal((await post(redemption, { code: expiredCode, verifier })).status, 401);
  const staleCode = await issue();
  const changed = await post("/api/auth/change-password", {
    currentPassword: password, newPassword: "UpdatedLocalPass123",
  }, browser);
  assert.equal(changed.status, 200);
  assert.equal((await session()).authenticated, false);
  assert.equal((await post(redemption, { code: staleCode, verifier })).status, 401);

  const links = await worker.dispatchFetch(origin + "/.well-known/assetlinks.json");
  assert.equal((await links.json())[0].target.package_name, "cn.com.xingyueji.offline");
  console.log("Android login needs an authenticated browser, consumes a verifier-bound code once, and revokes on password changes");
} finally {
  await worker.dispose();
}
