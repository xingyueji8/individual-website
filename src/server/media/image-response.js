/** 从 R2 输出图片预览、原图或锁定占位图。 */
import { entryBackgroundPhotos, readEntryBackgroundConfig } from "../content/background-selection.js";
import { contentSecurity } from "../content/permissions.js";
import { normalizedVisibility } from "../content/visibility.js";
import { HttpError, SECURITY_HEADERS } from "../http/responses.js";

const PROTECTED_IMAGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs><pattern id="m" width="80" height="80" patternUnits="userSpaceOnUse"><path fill="#d4d5d6" d="M0 0h80v80H0z"/><path fill="#9da3a9" d="M0 0h40v40H0zm40 40h40v40H40z"/><path fill="#b7bcc1" d="M40 0h40v40H40z"/></pattern></defs><path fill="url(#m)" d="M0 0h320v240H0z"/><rect x="132" y="102" width="56" height="48" rx="8" fill="#fff"/><path d="M143 102V90a17 17 0 0134 0v12" fill="none" stroke="#fff" stroke-width="8"/></svg>';

export async function serveMedia(request, env, id, share = null) {
  if (!env.BUCKET) throw new HttpError(503, "R2 存储桶尚未绑定");
  const security = share ? { requireView: (kind, target, options) => share.require(kind, target, options), canDownload: () => share.allowDownload }
    : await contentSecurity(request, env, { targets: [{ kind: "media", id }] });
  const requestParams = new URL(request.url).searchParams;
  if (requestParams.get("background") === "1" && requestParams.get("mosaic") === "1") throw new HttpError(404, "背景图片不存在");
  security.requireView("media", id, { allowLocked: requestParams.get("mosaic") === "1" });
  if (requestParams.get("mosaic") === "1") {
    const row = await env.DB.prepare("SELECT mosaic_object_key FROM media WHERE id=?").bind(id).first();
    const mosaic = row?.mosaic_object_key ? await env.BUCKET.get(row.mosaic_object_key) : null;
    return mosaic ? new Response(mosaic.body, { headers: { ...SECURITY_HEADERS, "Content-Type": "image/webp", "Cache-Control": "private, no-store" } })
      : new Response(PROTECTED_IMAGE_SVG, { headers: { ...SECURITY_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
  }
  const media = await env.DB.prepare(`
    SELECT m.id, m.section_id, m.subsection_id, m.album_id, m.object_key, m.preview_object_key,
           m.filename, m.mime_type, m.kind, m.visibility AS media_visibility,
           s.visibility AS section_visibility, ss.visibility AS subsection_visibility,
           a.visibility AS album_visibility
    FROM media m LEFT JOIN portfolio_sections s ON s.id = m.section_id
    LEFT JOIN portfolio_subsections ss ON ss.id = m.subsection_id
    LEFT JOIN albums a ON a.id = m.album_id
    WHERE m.id = ?
  `).bind(id).first();
  if (!media) throw new HttpError(404, "图片不存在");
  const params = new URL(request.url).searchParams;
  const wantsDownload = params.get("download") === "1";
  /*
   * 只有 ?preview=1 属于普通网站预览。去掉 preview 参数、直接访问 /media/id
   * 或使用 download=1 都是在请求原片，必须通过独立的下载权限校验。
   * 这样即使游客手工修改地址，也不能绕过前端隐藏的下载按钮。
   */
  const isPublicBackground = params.get("background") === "1";
  if (share && isPublicBackground) throw new HttpError(404, "分享入口不提供网站背景");
  const requestsOriginal = wantsDownload || (params.get("preview") !== "1" && !isPublicBackground);
  const modes = [media.section_visibility,
    ...(media.subsection_id ? [media.subsection_visibility] : []),
    ...(media.album_id ? [media.album_visibility] : []), media.media_visibility]
    .map(normalizedVisibility);
  const isProtected = modes.some((mode) => mode !== "public");
  if (isPublicBackground && isProtected) throw new HttpError(404, "图片不存在");
  if (isPublicBackground) {
    const { config } = await readEntryBackgroundConfig(env);
    // Recheck the scope and public ancestors on every image request, including
    // old carousel URLs. Admin/member sessions and redeemed locks cannot widen it.
    if (wantsDownload || !(await entryBackgroundPhotos(env, config, { id, limit: 1 })).length) {
      throw new HttpError(404, "图片不在当前背景轮播范围内");
    }
  }
  // requireView already checks the complete ancestor graph and selected users.
  // 公开查看不等于公开下载，读取原片仍须满足全部下载限制。
  if (requestsOriginal) security.requireView("media", id, { download: true });
  // 下载操作永远使用 object_key；只有普通展示请求才允许读取 WebP 预览件。
  const servesPreview = !wantsDownload && (params.get("preview") === "1" || isPublicBackground) && Boolean(media.preview_object_key);
  if (!requestsOriginal && !media.preview_object_key && !security.canDownload("media", id)) {
    return new Response(PROTECTED_IMAGE_SVG, { headers: { ...SECURITY_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
  }
  const object = await env.BUCKET.get(servesPreview ? media.preview_object_key : media.object_key);
  if (!object) throw new HttpError(404, "图片文件不存在");
  const headers = new Headers(SECURITY_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", servesPreview ? "image/webp" : media.mime_type);
  headers.set("ETag", object.httpEtag);
  const revalidatePreview = servesPreview && !share && !isPublicBackground &&
    !security.chain("media", id).some(node => security.locks.has(`${node.targetKind}:${node.id}`));
  headers.set(
    "Cache-Control",
    revalidatePreview ? "private, no-cache, must-revalidate" : "private, no-store",
  );
  if (revalidatePreview) {
    headers.set("Vary", "Cookie, X-Content-Grants");
    const validator = request.headers.get("If-None-Match") || "";
    const unchanged = validator.split(",").some(tag => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === object.httpEtag);
    // Authentication, inherited visibility and locks are checked BEFORE a 304.
    // Revoked permissions can never revive a previously cached preview.
    if (unchanged) return new Response(null, { status: 304, headers });
  }
  const previewName = media.filename.replace(/\.[^.]+$/, "") + "-preview.webp";
  headers.set(
    "Content-Disposition",
    `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(servesPreview ? previewName : media.filename)}`,
  );
  return new Response(object.body, { headers });
}
