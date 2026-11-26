/** 一次性密码重置的申请、查验、使用和 Studio 审核。 */
import { contactType, normalizeContact, normalizeUsername } from "./member-auth.js";
import { recordLoginEvent } from "./member-session.js";
import { createPasswordRecord, validatePassword } from "./passwords.js";
import { createNotification } from "../community/notifications.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { notifyPasswordResetRequest } from "../integrations/outbound-notices.js";
import { randomToken, sha256 } from "../shared/crypto.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { clientMeta } from "../shared/request-meta.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

const PASSWORD_RESET_TTL_SECONDS = 60 * 60 * 24;

export async function requestPasswordReset(request, env, ctx) {
  await consumeRateLimit(env, await clientRateKey(request, "password-reset-request"), 5, 60 * 60);
  const input = await readJson(request);
  const username = normalizeUsername(input.username);
  const type = contactType(input.contactType);
  const suppliedContact = clampText(input.contact, 160);
  const genericResult = { ok: true, message: "如果信息与账户一致，站长将通过预留联系方式与你核实。" };
  if (!username || !suppliedContact) return genericResult;

  const user = await env.DB.prepare(`
    SELECT u.id, u.username, u.nickname, u.status, p.contact_type, p.contact_value
    FROM users u JOIN user_profiles p ON p.user_id = u.id
    WHERE u.username_normalized = ?
  `).bind(username).first();
  const matches = user
    && user.status !== "disabled"
    && user.contact_type === type
    && normalizeContact(type, user.contact_value) === normalizeContact(type, suppliedContact);
  if (!matches) return genericResult;

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const meta = await clientMeta(request);
  // An unauthenticated request must never cancel a link the owner has already
  // approved. Coalesce active requests before sending any notification.
  const inserted = await env.DB.prepare(`INSERT INTO password_reset_requests
    (id,user_id,contact_type,contact_value,status,requested_at,ip_hash,ip_hint,user_agent)
    SELECT ?,?,?,?,'pending',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM password_reset_requests
      WHERE user_id=? AND (status='pending' OR (status='approved' AND expires_at>?)))`)
    .bind(id, user.id, type, suppliedContact, timestamp, meta.ipHash, meta.ipHint, meta.userAgent, user.id, timestamp).run();
  if (!inserted.meta.changes) return genericResult;
  const noticeJob = notifyPasswordResetRequest(env, {
    id, username: user.username, nickname: user.nickname,
    contactType: type, contact: suppliedContact, requestedAt: timestamp,
  }).catch((error) => console.error("Password reset notification failed", error));
  if (ctx) ctx.waitUntil(noticeJob); else await noticeJob;
  return genericResult;
}

export async function passwordResetInfo(request, env) {
  const token = clampText((await readJson(request)).token, 200);
  if (!token) return { valid: false };
  const requestRow = await env.DB.prepare(`
    SELECT r.id, r.expires_at, u.nickname
    FROM password_reset_requests r JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ? AND r.status = 'approved' AND r.expires_at > ? AND u.status <> 'disabled'
  `).bind(await sha256(token), nowIso()).first();
  return requestRow ? { valid: true, nickname: requestRow.nickname, expiresAt: requestRow.expires_at } : { valid: false };
}

export async function resetUserPassword(request, env) {
  await consumeRateLimit(env, await clientRateKey(request, "password-reset-finish"), 8, 60 * 60);
  const input = await readJson(request);
  const token = clampText(input.token, 200);
  const newPassword = validatePassword(input.newPassword, "新密码");
  if (!token) throw new HttpError(400, "重置链接无效或已过期");
  const tokenHash = await sha256(token);
  const reset = await env.DB.prepare(`
    SELECT r.id, r.user_id, u.username_normalized
    FROM password_reset_requests r JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ? AND r.status = 'approved' AND r.expires_at > ? AND u.status <> 'disabled'
  `).bind(tokenHash, nowIso()).first();
  if (!reset) throw new HttpError(400, "重置链接无效、已使用或已过期");

  const record = await createPasswordRecord(newPassword);
  const timestamp = nowIso();
  // D1 runs the batch in one transaction. Recheck the original token inside
  // every write, and consume it last so a stale request cannot change anything.
  const valid = `EXISTS (SELECT 1 FROM password_reset_requests r JOIN users u ON u.id=r.user_id
    WHERE r.id=? AND r.user_id=? AND r.token_hash=? AND r.status='approved'
      AND r.expires_at > ? AND u.status<>'disabled')`;
  const proof = [reset.id, reset.user_id, tokenHash, timestamp];
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash=?, password_salt=?, password_iterations=?,
      password_changed_at=?, updated_at=? WHERE id=? AND ${valid}`)
      .bind(record.hash, record.salt, record.iterations, timestamp, timestamp, reset.user_id, ...proof),
    env.DB.prepare(`UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND ${valid}`)
      .bind(timestamp, reset.user_id, ...proof),
    env.DB.prepare(`UPDATE password_reset_requests SET status='expired', token_hash=NULL
      WHERE user_id=? AND id<>? AND status IN ('pending','approved') AND ${valid}`)
      .bind(reset.user_id, reset.id, ...proof),
    env.DB.prepare(`UPDATE password_reset_requests SET status='used', used_at=?, token_hash=NULL WHERE id=? AND ${valid}`)
      .bind(timestamp, reset.id, ...proof),
  ]);
  if (!results[3].meta.changes) throw new HttpError(400, "重置链接无效、已使用或已过期");
  await recordLoginEvent(env, request, "password_reset", reset.user_id, reset.username_normalized);
  await createNotification(env, reset.user_id, {
    type: "account", title: "账号密码已通过重置流程更新",
    body: "如果这不是你的操作，请尽快联系站长。", targetUrl: "/#settings",
  });
  return { ok: true, message: "密码已重置，请使用新密码登录。" };
}

export async function adminPasswordResets(request, env, id) {
  if (request.method === "GET") {
    await env.DB.prepare(`
      UPDATE password_reset_requests SET status = 'expired'
      WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= ?
    `).bind(nowIso()).run();
    return rows(await env.DB.prepare(`
      SELECT r.id, r.user_id, r.contact_type, r.contact_value, r.status, r.requested_at,
             r.approved_at, r.expires_at, r.used_at, r.ip_hint, r.user_agent,
             u.username, u.nickname
      FROM password_reset_requests r JOIN users u ON u.id = r.user_id
      ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
               r.requested_at DESC
    `).all());
  }

  if (request.method === "PUT") {
    if (!validId(id)) throw new HttpError(400, "重置申请 ID 错误");
    const input = await readJson(request);
    const action = input.action;
    const reset = await env.DB.prepare(`
      SELECT r.*, u.status AS user_status FROM password_reset_requests r
      JOIN users u ON u.id = r.user_id WHERE r.id = ?
    `).bind(id).first();
    if (!reset) throw new HttpError(404, "重置申请不存在");

    if (action === "reject") {
      const result = await env.DB.prepare(`
        UPDATE password_reset_requests
        SET status = 'rejected', token_hash = NULL, expires_at = NULL WHERE id = ? AND status <> 'used'
      `).bind(id).run();
      if (!result.meta.changes) throw new HttpError(409, "申请已使用");
      return { id, status: "rejected" };
    }

    if (action === "approve" || action === "regenerate") {
      if (reset.user_status === "disabled") throw new HttpError(400, "停用账号不能生成重置链接");
      if (reset.status === "used") throw new HttpError(400, "该申请已经完成，请让用户重新提交申请");
      const token = randomToken();
      const timestamp = nowIso();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString();
      const result = await env.DB.prepare(`
        UPDATE password_reset_requests
        SET token_hash = ?, status = 'approved', approved_at = ?, expires_at = ?, used_at = NULL
        WHERE id = ? AND status <> 'used' AND EXISTS (SELECT 1 FROM users WHERE id=password_reset_requests.user_id AND status<>'disabled')
      `).bind(await sha256(token), timestamp, expiresAt, id).run();
      if (!result.meta.changes) throw new HttpError(409, "申请已使用或账号已停用");
      const origin = new URL(request.url).origin;
      return {
        id,
        status: "approved",
        expiresAt,
        resetUrl: `${origin}/login#reset=${encodeURIComponent(token)}`,
      };
    }
    throw new HttpError(400, "未知的重置操作");
  }

  throw new HttpError(405, "不支持的请求方法");
}
