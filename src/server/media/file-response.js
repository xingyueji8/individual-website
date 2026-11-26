/** 下载、文档和视频分段播放的实际文件响应。 */
import { contentSecurity } from "../content/permissions.js";
import { HttpError, SECURITY_HEADERS } from "../http/responses.js";
import { ASSET_VARIANT_LABELS, assetCanRenderInline, normalizedMimeType } from "./formats.js";

function parseByteRange(header, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
  if (!match || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  let start;
  let end;
  if (!match[1] && match[2]) {
    const suffix = Math.min(totalSize, Number(match[2]));
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = totalSize - suffix;
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= totalSize || end < start) return null;
  end = Math.min(end, totalSize - 1);
  return { offset: start, length: end - start + 1, start, end };
}

async function assetAccessContext(request, env, asset) {
  const security = await contentSecurity(request, env, { targets: [{ kind: "asset", id: asset.id }] });
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1"
    || asset.kind === "archive" || asset.kind === "file";
  security.requireView("asset", asset.id, { download: wantsDownload });
  return {
    wantsDownload, requireAttachment: () => security.requireView("asset", asset.id, { download: true }),
  };
}

/*
 * R2 文件统一通过 Worker 读取，避免公开存储桶地址绕过会员与私密权限。
 * Range 请求对大视频拖动进度条至关重要；HEAD 则让浏览器在播放前取得大小。
 */
export async function serveAsset(request, env, id, share = null) {
  if (!env.BUCKET) throw new HttpError(503, "R2 存储桶尚未绑定");
  if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "不支持的请求方法");
  if (share) share.require("asset", id);
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id = ? AND status = 'ready'").bind(id).first();
  if (!asset) throw new HttpError(404, "文件不存在或尚未上传完成");
  const params = new URL(request.url).searchParams;
  const variantLabel = params.get("variant") || "";
  const wantsPoster = params.get("poster") === "1";
  let objectKey = asset.object_key;
  let mimeType = asset.mime_type || "application/octet-stream";
  let filename = asset.filename;
  if (wantsPoster) {
    if (!asset.poster_object_key) throw new HttpError(404, "视频封面不存在");
    objectKey = asset.poster_object_key;
    mimeType = "image/jpeg";
    filename = `${asset.display_name || asset.filename}-poster.jpg`;
  } else if (variantLabel) {
    if (!ASSET_VARIANT_LABELS.has(variantLabel)) throw new HttpError(400, "文件版本参数错误");
    const variant = await env.DB.prepare(`
      SELECT object_key, mime_type, size_bytes FROM asset_variants
      WHERE asset_id = ? AND label = ? AND status = 'ready'
    `).bind(id, variantLabel).first();
    if (!variant) throw new HttpError(404, "该预览或清晰度版本尚不存在");
    objectKey = variant.object_key;
    mimeType = variant.mime_type || mimeType;
    const extension = mimeType === "application/pdf"
      ? ".pdf"
      : (mimeType === "video/mp4" ? ".mp4" : (String(asset.filename).match(/\.[^.]+$/)?.[0] || ""));
    filename = `${asset.display_name || asset.filename}-${variantLabel}${extension}`;
  }

  const access = share ? { requireAttachment: () => share.require("asset", id, { download: true }), wantsDownload: params.get("download") === "1" || asset.kind === "archive" || asset.kind === "file" }
    : await assetAccessContext(request, env, asset);
  const head = await env.BUCKET.head(objectKey);
  if (!head) throw new HttpError(404, "R2 中的文件对象不存在");
  if (wantsPoster && head.httpMetadata?.contentType) mimeType = head.httpMetadata.contentType;
  const rendersInline = !access.wantsDownload && assetCanRenderInline(asset, mimeType, { variantLabel, wantsPoster });
  if (!rendersInline) access.requireAttachment();
  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? parseByteRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { ...SECURITY_HEADERS, "Accept-Ranges": "bytes", "Content-Range": `bytes */${head.size}` },
    });
  }

  const object = request.method === "HEAD"
    ? null
    : await env.BUCKET.get(objectKey, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (request.method !== "HEAD" && !object) throw new HttpError(404, "R2 中的文件对象不存在");
  const headers = new Headers(SECURITY_HEADERS);
  head.writeHttpMetadata(headers);
  // 对不能安全内联的附件隐藏用户声明的主动内容类型，阻止直接访问时执行同源脚本。
  headers.set("Content-Type", rendersInline ? normalizedMimeType(mimeType) : "application/octet-stream");
  headers.set("ETag", head.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(range ? range.length : head.size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${head.size}`);
  headers.set("Cache-Control", "private, no-store");
  const disposition = rendersInline ? "inline" : "attachment";
  headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  if (rendersInline && normalizedMimeType(mimeType) === "application/pdf") {
    // 只允许本站资源查看器嵌入经过 MIME 收窄的 PDF。
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("Content-Security-Policy", "base-uri 'none'; object-src 'none'; frame-ancestors 'self'");
  } else if (!rendersInline) {
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  }
  return new Response(object?.body || null, { status: range ? 206 : 200, headers });
}
