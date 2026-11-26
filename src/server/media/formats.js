/** 媒体类型、内联预览限制、文件名及上传限制。 */

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// 预览件由站长后台在浏览器中压缩为 WebP；限制体积可避免伪装文件占用 R2。
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

/*
 * 通用文件不再经过 request.formData() 整体读入 Worker，而是使用 R2 multipart
 * API 逐片写入。每片默认由 Studio 切成 64MiB，并在服务端限制为 95MiB，
 * 因而低于 Cloudflare Free/Pro 的 100MB 单次请求上限。
 */
export const MAX_ASSET_BYTES = 100 * 1024 * 1024 * 1024;

export const ASSET_UPLOAD_PART_BYTES = 64 * 1024 * 1024;

export const LEGACY_ASSET_UPLOAD_PART_BYTES = 32 * 1024 * 1024;

export const MAX_UPLOAD_PART_BYTES = 95 * 1024 * 1024;

export const MAX_UPLOAD_PARTS = 10_000;

// R2 默认会在第七天清理未完成 multipart，会话提前一天到期以留出安全余量。
export const ASSET_UPLOAD_TTL_SECONDS = 60 * 60 * 24 * 6;

export const VIDEO_QUALITY_LABELS = new Set(["360p", "480p", "720p", "1080p"]);

export const ASSET_VARIANT_LABELS = new Set(["preview", ...VIDEO_QUALITY_LABELS]);

export function normalizedAssetKind(value, mimeType = "", filename = "") {
  const explicit = String(value || "").toLowerCase();
  if (["file", "pdf", "word", "archive", "video", "audio"].includes(explicit)) return explicit;
  const mime = String(mimeType || "").toLowerCase();
  const extension = String(filename || "").toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] || "";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword" || ["doc", "docx"].includes(extension)) return "word";
  if (mime.startsWith("video/") || ["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(extension)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "m4a", "wav", "flac", "aac", "ogg"].includes(extension)) return "audio";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(extension)
    || ["application/zip", "application/x-7z-compressed", "application/vnd.rar"].includes(mime)) return "archive";
  return "file";
}

const INLINE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
]);

const INLINE_VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/webm", "video/ogg", "video/quicktime",
]);

const INLINE_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac",
]);

export function normalizedMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

/*
 * assets 的 MIME 来自浏览器上传参数，不能据此把任意内容作为同源页面打开。
 * 只有网站确实需要内联展示、且浏览器不会把它当 HTML/脚本执行的少数格式
 * 可以 inline；HTML、SVG、XML、脚本以及普通附件一律按二进制下载。
 */
export function assetCanRenderInline(asset, mimeType, { variantLabel = "", wantsPoster = false } = {}) {
  const mime = normalizedMimeType(mimeType);
  if (wantsPoster) return INLINE_IMAGE_MIME_TYPES.has(mime);
  if (variantLabel === "preview") return mime === "application/pdf";
  if (asset.kind === "pdf") return mime === "application/pdf";
  if (asset.kind === "video") return INLINE_VIDEO_MIME_TYPES.has(mime);
  if (asset.kind === "audio") return INLINE_AUDIO_MIME_TYPES.has(mime);
  return false;
}

export function safeAssetFilename(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f:*?"<>|]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 220);
  return normalized || `file-${Date.now()}`;
}

export function safeRelativePath(value) {
  return String(value || "")
    .normalize("NFKC")
    .split(/[\\/]+/)
    .map((part) => safeAssetFilename(part))
    .filter((part) => part && part !== "." && part !== "..")
    .slice(0, 40)
    .join("/")
    .slice(0, 900);
}
