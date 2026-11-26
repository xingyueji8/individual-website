/** Studio API 的统一管理员鉴权和分发。 */
import { adminPasswordResets } from "../accounts/password-reset.js";
import { isAdmin, revokeAdminSession, secureCookie } from "../accounts/studio-session.js";
import { adminComments } from "../community/comments.js";
import { adminFeedback } from "../community/feedback.js";
import { adminMessages } from "../community/messages.js";
import { adminContent } from "../content/articles.js";
import { adminEntryBackground } from "../content/backgrounds.js";
import { adminAlbums, adminSections, adminSubsections } from "../content/boards.js";
import { adminChangelogs } from "../content/changelogs.js";
import { adminSecurity } from "../content/permissions.js";
import { sanitizeRichHtml } from "../content/rich-text.js";
import { adminSettings } from "../content/settings.js";
import { shareHooks } from "../content/share-api.js";
import { adminShares } from "../content/share-links.js";
import { readJson } from "./request.js";
import { HttpError, json } from "./responses.js";
import { adminAssets } from "../media/file-editor.js";
import { adminAssetUploads } from "../media/file-upload.js";
import { adminAssetFolders } from "../media/folders.js";
import { adminMedia } from "../media/photos.js";
import { nowIso } from "../shared/values.js";
import { adminDashboard, adminGuestAnalytics } from "../studio/overview.js";
import { adminUserEvents, adminUsers } from "../studio/users.js";

export async function handleAdmin(request, env, url) {
  if (!(await isAdmin(request, env))) throw new HttpError(401, "请先登录后台");
  const parts = url.pathname.split("/").filter(Boolean);
  const resource = parts[2] || "";
  const id = parts[3] || "";
  const action = parts[4] || "";
  const detail = parts[5] || "";

  if (resource === "session" && request.method === "GET") return { authenticated: true };
  if (resource === "logout" && request.method === "POST") {
    await revokeAdminSession(request, env);
    return json({ ok: true }, 200, { "Set-Cookie": secureCookie(request, "", 0) });
  }
  if (resource === "dashboard" && request.method === "GET") return adminDashboard(env);
  if (resource === "sections") return adminSections(request, env, id);
  if (resource === "shares") return adminShares(request, env, id, action, shareHooks());
  if (resource === "security") return adminSecurity(request, env, id, action);
  if (resource === "subsections") return adminSubsections(request, env, id);
  if (resource === "content") return adminContent(request, env, id);
  if (resource === "content-preview" && request.method === "POST") {
    const input = await readJson(request);
    return { body_html: sanitizeRichHtml(input.bodyHtml) };
  }
  if (resource === "changelogs") return adminChangelogs(request, env, id);
  if (resource === "albums") return adminAlbums(request, env, id);
  if (resource === "media") return adminMedia(request, env, id, action);
  if (resource === "photo-uploads" && request.method === "DELETE") {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "上传标识无效");
    await env.DB.prepare("INSERT OR IGNORE INTO photo_upload_cancellations(token,created_at) VALUES(?,?)").bind(id, nowIso()).run();
    const media = await env.DB.prepare("SELECT id FROM media WHERE upload_token=?").bind(id).first();
    if (media) await adminMedia(request, env, media.id);
    return { ok: true };
  }
  if (resource === "asset-folders") return adminAssetFolders(request, env, id);
  if (resource === "assets") return adminAssets(request, env, id, action);
  if (resource === "asset-uploads") return adminAssetUploads(request, env, id, action, detail);
  if (resource === "comments") return adminComments(request, env, id);
  if (resource === "feedback") return adminFeedback(request, env, id);
  if (resource === "users") return adminUsers(request, env, id);
  if (resource === "user-events") return adminUserEvents(request, env, id, url);
  if (resource === "password-resets") return adminPasswordResets(request, env, id);
  if (resource === "guest-analytics") return adminGuestAnalytics(request, env, url);
  if (resource === "messages") return adminMessages(request, env, id);
  if (resource === "settings") return adminSettings(request, env);
  if (resource === "entry-background" && !id) return adminEntryBackground(request, env);
  throw new HttpError(404, "后台接口不存在");
}
