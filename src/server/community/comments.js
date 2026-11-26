/** 公开评论与 Studio 评论审核、置顶、作者赞。 */
import { requireAuthenticatedUser } from "../accounts/member-session.js";
import { createNotification } from "./notifications.js";
import { getPublicContent } from "../content/articles.js";
import { settingsObject } from "../content/settings.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

export async function listPublicComments(request, env, contentId) {
  // 评论跟随文章权限；会员文章的评论不能通过直接调用 API 被游客读取。
  await getPublicContent(request, env, contentId);
  const result = await env.DB.prepare(`
    SELECT id, content_id, parent_id, guest_name, body, like_count, dislike_count,
           author_user_id, is_admin, is_pinned, author_liked, created_at
    FROM comments
    WHERE content_id = ? AND status = 'active'
    ORDER BY is_pinned DESC, created_at ASC
  `).bind(contentId).all();
  return rows(result);
}

export async function createComment(request, env) {
  const authorUser = await requireAuthenticatedUser(request, env);
  await consumeRateLimit(env, await clientRateKey(request, "comment"), 20, 60 * 60);
  const body = await readJson(request);
  const contentId = clampText(body.contentId, 80);
  const parentId = clampText(body.parentId, 80) || null;
  const commentBody = clampText(body.body, 1000);
  const guestName = authorUser.nickname;
  let replyNotification = null;

  if (!validId(contentId) || !guestName || commentBody.length < 2) {
    throw new HttpError(400, "请填写评论内容");
  }
  await getPublicContent(request, env, contentId);

  if (parentId) {
    const parent = await env.DB.prepare(
      "SELECT id, author_user_id, guest_name FROM comments WHERE id = ? AND content_id = ? AND status = 'active'",
    ).bind(parentId, contentId).first();
    if (!parent) throw new HttpError(400, "要回复的评论不存在");
    if (parent.author_user_id && parent.author_user_id !== authorUser?.id) {
      const article = await env.DB.prepare("SELECT title FROM content WHERE id = ?").bind(contentId).first();
      replyNotification = { userId: parent.author_user_id, payload: {
        type: "comment_reply", title: `${guestName} 回复了你的评论`,
        body: `${article?.title || "文章"}：${commentBody}`,
        targetUrl: `/#article-${contentId}`, actorUserId: authorUser?.id || null,
      } };
    }
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO comments
      (id, content_id, parent_id, guest_name, body, status, like_count, dislike_count,
       author_user_id, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?, 0, ?, ?)
  `).bind(id, contentId, parentId, guestName, commentBody, authorUser?.id || null, timestamp, timestamp).run();

  if (replyNotification) {
    await createNotification(env, replyNotification.userId, replyNotification.payload)
      .catch((error) => console.error("Comment reply notification failed", error));
  }

  return {
    id, contentId, parentId, guestName, body: commentBody, like_count: 0, dislike_count: 0,
    author_user_id: authorUser.id, is_admin: 0, is_pinned: 0, author_liked: 0, created_at: timestamp,
  };
}

export async function adminComments(request, env, id) {
  if (request.method === "GET") {
    return rows(await env.DB.prepare(`
      SELECT c.*, p.title AS content_title
      FROM comments c LEFT JOIN content p ON p.id = c.content_id
      ORDER BY c.is_pinned DESC, c.created_at DESC
    `).all());
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    const contentId = clampText(body.contentId, 80);
    const commentBody = clampText(body.body, 1000);
    if (!validId(contentId) || !commentBody) throw new HttpError(400, "请选择文章并填写评论内容");
    const content = await env.DB.prepare("SELECT id FROM content WHERE id = ?").bind(contentId).first();
    if (!content) throw new HttpError(404, "文章不存在");
    const settings = await settingsObject(env);
    const owner = validId(settings.owner_user_id)
      ? await env.DB.prepare("SELECT id, nickname FROM users WHERE id = ? AND status = 'approved'")
        .bind(settings.owner_user_id).first()
      : null;
    const commentId = crypto.randomUUID();
    const timestamp = nowIso();
    await env.DB.prepare(`
      INSERT INTO comments
        (id, content_id, parent_id, guest_name, body, status, like_count, dislike_count,
         author_user_id, is_admin, is_pinned, author_liked, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, 'active', 0, 0, ?, 1, 0, 0, ?, ?)
    `).bind(
      commentId, contentId, owner?.nickname || settings.owner_name || "星月集",
      commentBody, owner?.id || null, timestamp, timestamp,
    ).run();
    return { id: commentId, contentId };
  }
  if (request.method === "PUT") {
    const body = await readJson(request);
    if (!validId(id)) throw new HttpError(400, "评论 ID 错误");
    if (body.action === "pin") {
      const pinned = body.value === true ? 1 : 0;
      await env.DB.prepare("UPDATE comments SET is_pinned = ?, updated_at = ? WHERE id = ?")
        .bind(pinned, nowIso(), id).run();
      return { id, is_pinned: pinned };
    }
    if (body.action === "author-like") {
      const authorLiked = body.value === true ? 1 : 0;
      await env.DB.prepare("UPDATE comments SET author_liked = ?, updated_at = ? WHERE id = ?")
        .bind(authorLiked, nowIso(), id).run();
      return { id, author_liked: authorLiked };
    }
    if (body.action === "reply") {
      const parent = await env.DB.prepare(`
        SELECT c.id, c.content_id, c.author_user_id, p.title AS content_title
        FROM comments c LEFT JOIN content p ON p.id = c.content_id
        WHERE c.id = ?
      `).bind(id).first();
      if (!parent) throw new HttpError(404, "评论不存在");
      const replyBody = clampText(body.body, 1000);
      if (!replyBody) throw new HttpError(400, "回复内容不能为空");
      const settings = await settingsObject(env);
      const owner = validId(settings.owner_user_id)
        ? await env.DB.prepare("SELECT id, nickname FROM users WHERE id = ? AND status = 'approved'")
          .bind(settings.owner_user_id).first()
        : null;
      const replyId = crypto.randomUUID();
      const timestamp = nowIso();
      await env.DB.prepare(`
        INSERT INTO comments
          (id, content_id, parent_id, guest_name, body, status, like_count, dislike_count,
           author_user_id, is_admin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?, 1, ?, ?)
      `).bind(
        replyId, parent.content_id, parent.id, owner?.nickname || settings.owner_name || "星月集",
        replyBody, owner?.id || null, timestamp, timestamp,
      ).run();
      if (parent.author_user_id && parent.author_user_id !== owner?.id) {
        await createNotification(env, parent.author_user_id, {
          type: "comment_reply", title: "站长回复了你的评论",
          body: `${parent.content_title || "文章"}：${replyBody}`,
          targetUrl: `/#article-${parent.content_id}`, actorUserId: owner?.id || null,
        });
      }
      return { id: replyId, parentId: parent.id };
    }
    const status = body.status === "hidden" ? "hidden" : "active";
    await env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, nowIso(), id).run();
    return { id, status };
  }
  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "评论 ID 错误");
    const existing = await env.DB.prepare("SELECT id FROM comments WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "评论不存在或已经删除");

    /*
     * 递归 CTE 会找出目标评论、直接回复以及更深层的全部回复。先清理这些
     * 评论的点赞/点踩，再删除评论树，避免只删一层后留下孤立回复。
     */
    const commentTreeSql = `
      WITH RECURSIVE comment_tree(id) AS (
        SELECT id FROM comments WHERE id = ?
        UNION ALL
        SELECT child.id
        FROM comments child JOIN comment_tree parent ON child.parent_id = parent.id
      )
      SELECT id FROM comment_tree
    `;
    await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM reactions
        WHERE target_type = 'comment' AND target_id IN (${commentTreeSql})
      `).bind(id),
      env.DB.prepare(`DELETE FROM comments WHERE id IN (${commentTreeSql})`).bind(id),
    ]);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
