/** 留言及处理状态：公开读写与 Studio 审核和回复。 */
import { requireAuthenticatedUser } from "../accounts/member-session.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

export async function listPublicFeedback(env) {
  const result = await env.DB.prepare(`
    SELECT id, guest_name, category, body, status, admin_reply, admin_replied_at, created_at
    FROM feedback
    WHERE is_public = 1 AND status != 'resolved'
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  return rows(result);
}

export async function createFeedback(request, env) {
  const user = await requireAuthenticatedUser(request, env);
  await consumeRateLimit(env, await clientRateKey(request, "feedback"), 10, 60 * 60);
  const input = await readJson(request);
  const guestName = user.nickname;
  const contact = clampText(input.contact, 160);
  const category = ["message", "bug", "suggestion"].includes(input.category) ? input.category : "message";
  const body = clampText(input.body, 3000);
  const isPublic = input.isPublic === true ? 1 : 0;
  if (!guestName || body.length < 2) throw new HttpError(400, "请填写留言内容");

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO feedback
      (id, guest_name, contact, category, body, status, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).bind(id, guestName, contact, category, body, isPublic, timestamp, timestamp).run();
  return { id, guest_name: guestName, contact, category, body, status: "new", is_public: isPublic, created_at: timestamp };
}

export async function adminFeedback(request, env, id) {
  if (request.method === "GET") {
    return rows(await env.DB.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all());
  }
  if (request.method === "PUT") {
    if (!validId(id)) throw new HttpError(400, "留言 ID 错误");
    const input = await readJson(request);
    const existing = await env.DB.prepare(
      "SELECT id, status, is_public, admin_reply, admin_replied_at FROM feedback WHERE id = ?",
    ).bind(id).first();
    if (!existing) throw new HttpError(404, "留言不存在或已经删除");
    const status = ["new", "read", "resolved"].includes(input.status) ? input.status : "read";
    const isPublic = input.isPublic === true ? 1 : 0;
    const updatesReply = Object.prototype.hasOwnProperty.call(input, "adminReply");
    const adminReply = updatesReply ? clampText(input.adminReply, 3000) : String(existing.admin_reply || "");
    const repliedAt = updatesReply
      ? (adminReply ? nowIso() : null)
      : (existing.admin_replied_at || null);
    await env.DB.prepare(
      "UPDATE feedback SET status = ?, is_public = ?, admin_reply = ?, admin_replied_at = ?, updated_at = ? WHERE id = ?",
    ).bind(status, isPublic, adminReply, repliedAt, nowIso(), id).run();
    return { id, status, is_public: isPublic, admin_reply: adminReply, admin_replied_at: repliedAt };
  }
  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "留言 ID 错误");
    const result = await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
    if (!Number(result.meta?.changes || 0)) throw new HttpError(404, "留言不存在或已经删除");
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
