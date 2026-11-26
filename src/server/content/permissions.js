/** 每请求权限图、一次性内容锁的解锁与释放、Studio 权限设置。 */
import { createPasswordRecord, verifyPassword } from "../accounts/passwords.js";
import { requireShareNavigationLogin, websiteAccessContext } from "../accounts/website-access.js";
import { createContentSecurity, SECURITY_TABLES } from "./permission-graph.js";
import { ACCESS_TABLES, validatedAllowedUserIds, visibleToWebsite } from "./visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { sha256 } from "../shared/crypto.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { nowIso, rows, validId } from "../shared/values.js";

const requestSecurity = new WeakMap();

export async function contentSecurity(request, env, seed = {}) {
  await requireShareNavigationLogin(request, env);
  if (!requestSecurity.has(request)) requestSecurity.set(request, (async () => createContentSecurity(
    request, env, seed.context || await websiteAccessContext(request, env), {
      error: (status, message) => new HttpError(status, message), hash: sha256,
      visible: visibleToWebsite, accessTables: ACCESS_TABLES,
    }, seed,
  ))());
  return requestSecurity.get(request);
}

export async function adminSecurity(request, env, kind, id) {
  if (request.method === "GET" && !kind) {
    const [downloads, locks] = await Promise.all([
      env.DB.prepare("SELECT * FROM download_rules").all(),
      env.DB.prepare("SELECT target_kind,target_id,enabled,consumed_at,updated_at FROM content_locks").all(),
    ]);
    return { downloads: rows(downloads).map(row => ({ ...row, user_ids: JSON.parse(row.user_ids) })), locks: rows(locks) };
  }
  if (!Object.hasOwn(SECURITY_TABLES, kind) || !validId(id)) throw new HttpError(400, "内容类型或 ID 无效");
  const target = await env.DB.prepare(`SELECT id FROM ${SECURITY_TABLES[kind]} WHERE id = ?`).bind(id).first();
  if (!target) throw new HttpError(404, "内容不存在");
  if (request.method !== "PUT") throw new HttpError(405, "不支持的请求方法");
  const input = await readJson(request);
  const timestamp = nowIso();
  // Validate the complete request before any write: a malformed password must
  // not half-save the adjacent download settings.
  let download;
  if (input.download) {
    const mode = input.download.mode;
    if (!["inherit", "public", "member", "selected", "excluded", "private", "none"].includes(mode)) throw new HttpError(400, "下载权限无效");
    download = { mode, ids: await validatedAllowedUserIds(env, mode, input.download.userIds) };
  }
  let password;
  if (input.lock?.enabled === true) {
    if (typeof input.lock.code !== "string" || !/^\d{6}$/.test(input.lock.code)) throw new HttpError(400, "请输入六位数字密码，可包含开头的 0");
    password = await createPasswordRecord(input.lock.code);
  } else if (input.lock && input.lock.enabled !== false) throw new HttpError(400, "锁定设置无效");
  const statements = [];
  if (download) {
    if (download.mode === "inherit") statements.push(env.DB.prepare("DELETE FROM download_rules WHERE target_kind=? AND target_id=?").bind(kind, id));
    else statements.push(env.DB.prepare(`INSERT INTO download_rules(target_kind,target_id,mode,user_ids,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET mode=excluded.mode,user_ids=excluded.user_ids,updated_at=excluded.updated_at`)
      .bind(kind, id, download.mode, JSON.stringify(download.ids), timestamp));
  }
  if (input.lock) {
    statements.push(env.DB.prepare(`INSERT INTO content_locks(target_kind,target_id,enabled,version,password_hash,password_salt,password_iterations,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,
      password_hash=excluded.password_hash,password_salt=excluded.password_salt,password_iterations=excluded.password_iterations,
      consumed_at=NULL,redemption_id=NULL,updated_at=excluded.updated_at`)
      .bind(kind, id, input.lock.enabled ? 1 : 0, crypto.randomUUID(), password?.hash || null, password?.salt || null, password?.iterations || null, timestamp));
    statements.push(env.DB.prepare("DELETE FROM content_grants WHERE target_kind=? AND target_id=?").bind(kind, id));
  }
  if (!statements.length) throw new HttpError(400, "没有要保存的设置");
  await env.DB.batch(statements);
  return { ok: true };
}

export async function unlockContent(request, env) {
  const security = await contentSecurity(request, env);
  const input = await readJson(request);
  const { kind, id } = input;
  if (!Object.hasOwn(SECURITY_TABLES, kind) || !validId(id)) throw new HttpError(400, "内容参数无效");
  // Deliberately before password lookup / rate count: unauthorized users cannot
  // test a password or consume the intended recipient's one-use code.
  security.requireView(kind, id, { allowLocked: true });
  const firstLock = security.blockedLocks(kind, id)[0];
  if (firstLock && (firstLock.kind !== kind || firstLock.id !== id)) throw new HttpError(423, "请先解锁上级板块");
  await consumeRateLimit(env, `unlock:${security.principal}:${kind}:${id}`, 5, 600);
  await consumeRateLimit(env, await clientRateKey(request, "unlock"), 30, 600);
  const lock = await env.DB.prepare("SELECT * FROM content_locks WHERE target_kind=? AND target_id=? AND enabled=1").bind(kind, id).first();
  if (!lock) throw new HttpError(409, "内容未上锁，请刷新页面");
  if (lock.consumed_at) throw new HttpError(409, "密码已使用，请联系站长重新设置密码");
  if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code) || !(await verifyPassword(input.code, lock))) throw new HttpError(403, "密码错误");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE content_locks SET consumed_at=?,redemption_id=?,password_hash=NULL
      WHERE target_kind=? AND target_id=? AND enabled=1 AND version=? AND consumed_at IS NULL AND password_hash=?`)
      .bind(nowIso(), tokenHash, kind, id, lock.version, lock.password_hash),
    env.DB.prepare(`INSERT INTO content_grants(token_hash,principal,target_kind,target_id,version,expires_at)
      SELECT ?,?,?,?,?,? FROM content_locks WHERE target_kind=? AND target_id=? AND enabled=1 AND version=? AND redemption_id=?`)
      .bind(tokenHash, security.principal, kind, id, lock.version, expiresAt, kind, id, lock.version, tokenHash),
  ]);
  if (!result[0].meta.changes || !result[1].meta.changes) throw new HttpError(409, "密码已使用或已被重新设置，请联系站长");
  return { token, expiresAt, kind, id };
}

export async function releaseContentGrants(request, env) {
  const security = await contentSecurity(request, env);
  await env.DB.prepare("DELETE FROM content_grants WHERE principal=? AND token_hash IN (SELECT value FROM json_each(?))")
    .bind(security.principal, JSON.stringify(security.tokenHashes)).run();
  return { ok: true };
}
