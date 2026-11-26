/** 数据库媒体记录转成前台与 Studio 使用的 JSON。 */
import { normalizedVisibility, normalizedDownloadPolicy } from "../content/visibility.js";

export function mediaDto(row, { includeOriginal = true } = {}) {
  // R2 对象键只供 Worker 内部使用，公开接口和后台页面都只拿受控媒体地址。
  const { object_key: _objectKey, preview_object_key: previewObjectKey, mosaic_object_key: mosaicKey, sha256: _hash, ...safeRow } = row;
  const previewVersion = encodeURIComponent(String(safeRow.updated_at || safeRow.created_at || "1"));
  return {
    ...safeRow,
    hasPreview: Boolean(previewObjectKey),
    hasMosaic: Boolean(mosaicKey),
    // url/previewUrl 均为压缩预览；originalUrl 只用于明确需要原片的后台操作。
    url: `/media/${row.id}?preview=1&v=${previewVersion}`,
    previewUrl: `/media/${row.id}?preview=1&v=${previewVersion}`,
    // 游客 bootstrap 不下发原片地址；审核通过的账号与 Studio 才会收到。
    ...(includeOriginal ? {
      originalUrl: `/media/${row.id}`,
      downloadUrl: `/media/${row.id}?download=1`,
    } : {}),
  };
}

function assetVariantDto(row, { includeDownload = false } = {}) {
  const safe = {
    id: row.id,
    asset_id: row.asset_id,
    label: row.label,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes || 0),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: `/files/${row.asset_id}?variant=${encodeURIComponent(row.label)}`,
  };
  if (includeDownload) safe.downloadUrl = `${safe.url}&download=1`;
  return safe;
}

export function assetDto(row, variants = [], { includeDownload = false } = {}) {
  const safe = {
    id: row.id,
    folder_id: row.folder_id || null,
    section_id: row.section_id || null,
    subsection_id: row.subsection_id || null,
    album_id: row.album_id || null,
    filename: row.filename,
    display_name: row.display_name,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes || 0),
    kind: row.kind,
    visibility: normalizedVisibility(row.access_mode || row.visibility),
    scope: ["library", "article", "gallery", "section"].includes(row.scope) ? row.scope : "library",
    content_id: row.content_id || null,
    note: row.note || "",
    download_policy: normalizedDownloadPolicy(row.download_policy),
    relative_path: row.relative_path || "",
    status: row.status,
    stream_uid: row.stream_uid || "",
    stream_hls_url: row.stream_hls_url || "",
    stream_dash_url: row.stream_dash_url || "",
    poster_url: row.poster_object_key
      ? `/files/${row.id}?poster=1&v=${encodeURIComponent(String(row.updated_at || "1"))}`
      : (row.poster_url || ""),
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: `/files/${row.id}`,
    variants: variants.map((item) => assetVariantDto(item, { includeDownload })),
    canDownload: includeDownload,
  };
  if (includeDownload) safe.downloadUrl = `/files/${row.id}?download=1`;
  return safe;
}
