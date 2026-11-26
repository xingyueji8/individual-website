/** 文章与评论的赞、踩和重复投票处理。 */
import { requireAuthenticatedUser } from "../accounts/member-session.js";
import { getPublicContent } from "../content/articles.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { clampText, nowIso, validId } from "../shared/values.js";

export async function react(request, env) {
  const user = await requireAuthenticatedUser(request, env);
  await consumeRateLimit(env, await clientRateKey(request, "reaction"), 120, 60 * 60);
  const body = await readJson(request);
  const targetType = body.targetType === "comment" ? "comment" : body.targetType === "content" ? "content" : "";
  const targetId = clampText(body.targetId, 80);
  const visitorId = `user-${user.id}`;
  const value = Number(body.value);

  if (!targetType || !validId(targetId) || ![-1, 1].includes(value)) {
    throw new HttpError(400, "反应参数错误");
  }

  if (targetType === "content") {
    await getPublicContent(request, env, targetId);
  } else {
    const comment = await env.DB.prepare("SELECT content_id FROM comments WHERE id = ?").bind(targetId).first();
    if (!comment) throw new HttpError(404, "目标不存在");
    await getPublicContent(request, env, comment.content_id);
  }

  const table = targetType === "content" ? "content" : "comments";
  const target = await env.DB.prepare(`SELECT id, like_count, dislike_count FROM ${table} WHERE id = ?`)
    .bind(targetId).first();
  if (!target) throw new HttpError(404, "目标不存在");

  const old = await env.DB.prepare(
    "SELECT id, value FROM reactions WHERE visitor_id = ? AND target_type = ? AND target_id = ?",
  ).bind(visitorId, targetType, targetId).first();

  let likeDelta = 0;
  let dislikeDelta = 0;
  let activeValue = value;
  const timestamp = nowIso();
  const statements = [];

  if (old && Number(old.value) === value) {
    activeValue = 0;
    likeDelta = value === 1 ? -1 : 0;
    dislikeDelta = value === -1 ? -1 : 0;
    statements.push(env.DB.prepare("DELETE FROM reactions WHERE id = ?").bind(old.id));
  } else if (old) {
    likeDelta = value === 1 ? 1 : -1;
    dislikeDelta = value === -1 ? 1 : -1;
    statements.push(
      env.DB.prepare("UPDATE reactions SET value = ?, updated_at = ? WHERE id = ?")
        .bind(value, timestamp, old.id),
    );
  } else {
    likeDelta = value === 1 ? 1 : 0;
    dislikeDelta = value === -1 ? 1 : 0;
    statements.push(
      env.DB.prepare(`
        INSERT INTO reactions (id, visitor_id, target_type, target_id, value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), visitorId, targetType, targetId, value, timestamp, timestamp),
    );
  }

  statements.push(
    env.DB.prepare(`
      UPDATE ${table}
      SET like_count = MAX(0, like_count + ?),
          dislike_count = MAX(0, dislike_count + ?)
      WHERE id = ?
    `).bind(likeDelta, dislikeDelta, targetId),
  );
  await env.DB.batch(statements);

  const updated = await env.DB.prepare(`SELECT like_count, dislike_count FROM ${table} WHERE id = ?`)
    .bind(targetId).first();
  return { ...updated, activeValue };
}
