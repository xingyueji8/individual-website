/** 文章读取与 Studio 的草稿、发布和删除。 */
import { websiteAccessContext } from "../accounts/website-access.js";
import { notifyArticlePublished } from "../community/notifications.js";
import {
  deleteContentCascade,
  deleteRemovedArticleAssets,
  syncEmbeddedArticleAssets,
} from "./article-attachments.js";
import { contentSectionId } from "./board-lookup.js";
import { contentSecurity } from "./permissions.js";
import { sanitizeRichHtml, slugify } from "./rich-text.js";
import {
  attachAllowedUserIds,
  canAccessTarget,
  normalizedVisibility,
  replaceAllowedUsers,
  validateChildAccessSubset,
  validatedAllowedUserIds,
} from "./visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

export async function getPublicContent(request, env, id) {
  const security = await contentSecurity(request, env);
  security.requireView("content", id, { download: new URL(request.url).searchParams.get("download") === "1" });
  const item = await env.DB.prepare(`
    SELECT c.id, c.type, c.section_id, c.subsection_id, c.title, c.slug, c.excerpt, c.body_html,
           c.cover_media_id, c.published_at, c.created_at, c.updated_at,
           c.like_count, c.dislike_count, c.visibility,
           s.name AS section_name, s.visibility AS section_visibility,
           ss.visibility AS subsection_visibility
    FROM content c LEFT JOIN portfolio_sections s ON s.id = c.section_id
    LEFT JOIN portfolio_subsections ss ON ss.id = c.subsection_id
    WHERE c.id = ? AND c.status = 'published'
  `).bind(id).first();
  if (!item) throw new HttpError(404, "内容不存在或尚未发布");
  const context = await websiteAccessContext(request, env);
  const layers = [
    ["section", item.section_id, item.section_visibility],
    ...(item.subsection_id ? [["subsection", item.subsection_id, item.subsection_visibility]] : []),
    ["content", item.id, item.visibility],
  ];
  for (const [kind, targetId, visibility] of layers) {
    if (!(await canAccessTarget(env, kind, targetId, visibility, context))) {
      // 不向无权限账号暴露文章是否存在，行为与不存在保持一致。
      throw new HttpError(404, "内容不存在或尚未发布");
    }
  }
  const inlineMedia = [];
  const contentResponse = new HTMLRewriter().on("img", {
    element(element) {
      const src = element.getAttribute("src") || "";
      let source;
      try { source = new URL(src, request.url); } catch { return; }
      if (source.origin !== new URL(request.url).origin) return;
      const mediaId = source.pathname.match(/^\/media\/([a-zA-Z0-9_-]{1,80})$/)?.[1];
      if (!mediaId) return;
      if (!security.canView("media", mediaId)) {
        element.setAttribute("src", "/protected-image.svg");
        element.setAttribute("alt", "无权查看此图片");
        element.removeAttribute("srcset");
        return;
      }
      const info = security.decorate("media", { id: mediaId, url: `/media/${mediaId}?preview=1`, previewUrl: `/media/${mediaId}?preview=1` });
      inlineMedia.push(info);
      element.setAttribute("src", info.previewUrl);
      element.setAttribute("data-media-id", mediaId);
      element.removeAttribute("srcset");
    },
  }).transform(new Response(item.body_html));
  return {
    ...item,
    body_html: await contentResponse.text(), inlineMedia, canDownload: security.canDownload("content", id),
    coverUrl: item.cover_media_id ? `/media/${item.cover_media_id}?preview=1` : null,
  };
}

export async function adminContent(request, env, id) {
  if (request.method === "GET") {
    if (id) {
      const item = await env.DB.prepare("SELECT * FROM content WHERE id = ?").bind(id).first();
      if (!item) throw new HttpError(404, "内容不存在");
      return (await attachAllowedUserIds(env, "content", [item]))[0];
    }
    const items = rows(await env.DB.prepare("SELECT * FROM content ORDER BY updated_at DESC").all());
    return attachAllowedUserIds(env, "content", items);
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    const type = body.type === "guide" ? "guide" : "article";
    const sectionId = await contentSectionId(env, body.sectionId, type);
    let subsectionId = validId(body.subsectionId) ? String(body.subsectionId) : null;
    if (subsectionId) {
      const subsection = await env.DB.prepare(
        "SELECT id FROM portfolio_subsections WHERE id = ? AND section_id = ?",
      ).bind(subsectionId, sectionId).first();
      if (!subsection) throw new HttpError(400, "请选择当前大板块下的有效小板块");
    }
    const title = clampText(body.title, 120);
    const excerpt = clampText(body.excerpt, 500);
    const bodyHtml = sanitizeRichHtml(body.bodyHtml);
    const coverMediaId = validId(body.coverMediaId) ? body.coverMediaId : null;
    const status = body.status === "published" ? "published" : "draft";
    const visibility = normalizedVisibility(body.visibility);
    const allowedUserIds = await validatedAllowedUserIds(env, visibility, body.allowedUserIds);
    await validateChildAccessSubset(env, "section", sectionId, visibility, allowedUserIds);
    if (subsectionId) {
      await validateChildAccessSubset(env, "subsection", subsectionId, visibility, allowedUserIds);
    }
    if (!title) throw new HttpError(400, "标题不能为空");
    const timestamp = nowIso();

    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      let slug = `${slugify(title)}-${newId.slice(0, 8)}`;
      await env.DB.prepare(`
        INSERT INTO content
          (id, type, section_id, subsection_id, title, slug, excerpt, body_html, cover_media_id, status, published_at,
           like_count, dislike_count, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
      `).bind(
        newId, type, sectionId, subsectionId, title, slug, excerpt, bodyHtml, coverMediaId, status,
        status === "published" ? timestamp : null, visibility, timestamp, timestamp,
      ).run();
      await replaceAllowedUsers(env, "content", newId, allowedUserIds, timestamp);
      await syncEmbeddedArticleAssets(env, {
        id: newId, type, section_id: sectionId, subsection_id: subsectionId, cover_media_id: coverMediaId,
      }, bodyHtml, timestamp);
      if (status === "published") await notifyArticlePublished(env, newId, title);
      return { id: newId };
    }

    if (!validId(id)) throw new HttpError(400, "内容 ID 错误");
    const existing = await env.DB.prepare("SELECT id, status, published_at FROM content WHERE id = ?").bind(id).first();
    if (!existing) throw new HttpError(404, "内容不存在");
    const publishedAt = status === "published" ? (existing.published_at || timestamp) : null;
    await env.DB.prepare(`
      UPDATE content
      SET type = ?, section_id = ?, subsection_id = ?, title = ?, excerpt = ?, body_html = ?, cover_media_id = ?,
          status = ?, visibility = ?, published_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(type, sectionId, subsectionId, title, excerpt, bodyHtml, coverMediaId, status, visibility, publishedAt, timestamp, id).run();
    await syncEmbeddedArticleAssets(env, {
      id, type, section_id: sectionId, subsection_id: subsectionId, cover_media_id: coverMediaId,
    }, bodyHtml, timestamp);
    await env.DB.prepare(`
      UPDATE assets SET section_id = ?, subsection_id = ?, updated_at = ?
      WHERE scope = 'article' AND content_id = ?
    `).bind(sectionId, subsectionId, timestamp, id).run();
    await replaceAllowedUsers(env, "content", id, allowedUserIds, timestamp);
    const attachmentDeletion = await deleteRemovedArticleAssets(env, id, bodyHtml, body.deleteAssetIds);
    if (status === "published" && existing.status !== "published") {
      await notifyArticlePublished(env, id, title);
    }
    return { id, ...attachmentDeletion };
  }

  if (request.method === "DELETE") {
    if (!validId(id)) throw new HttpError(400, "内容 ID 错误");
    await deleteContentCascade(env, id);
    return { ok: true };
  }

  throw new HttpError(405, "不支持的请求方法");
}
