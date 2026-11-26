/** 前台启动数据：汇总已授权的板块、内容、资源和个人设置。 */
import { getGuestSession } from "../accounts/guest-session.js";
import { getUserSession } from "../accounts/member-session.js";
import { isAdmin } from "../accounts/studio-session.js";
import { contentSecurity } from "./permissions.js";
import { PROFILE_SECTION_DEFINITIONS, publicSettingsObject, settingsObject } from "./settings.js";
import {
  ACCESS_TABLES,
  normalizedVisibility,
  normalizedDownloadPolicy,
  visibleAssetFolderIds,
  visibleToWebsite,
} from "./visibility.js";
import { assetDto, mediaDto } from "../media/metadata.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { rows, validId } from "../shared/values.js";

export async function publicBootstrap(request, env) {
  // 游客会话代表公开站点当前明确选择的身份，不能被并存的高权限 Cookie 覆盖。
  const guestSession = await getGuestSession(request, env);
  const sessionUser = guestSession ? null : await getUserSession(request, env);
  const fullAccess = sessionUser?.status === "approved";
  const adminAccess = guestSession ? false : await isAdmin(request, env);
  const [
    changelogs, sections, subsections, content, albums, media, assetFolders, assets, assetVariants, settings,
    contentAccess, mediaAccess, sectionAccess, subsectionAccess, albumAccess, folderAccess, assetAccess,
    profileSectionAccess,
  ] = await Promise.all([
    env.DB.prepare(
      "SELECT id, version, title, body, published_at, sort_order FROM changelogs ORDER BY sort_order DESC, published_at DESC, created_at DESC",
    ).all(),
    env.DB.prepare(`
      SELECT id, name, kind, category, description, sort_order, show_all, visibility, download_policy, article_layout, gallery_layout
      FROM portfolio_sections ORDER BY sort_order ASC, created_at ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, section_id, parent_id, name, description, sort_order, visibility, download_policy, article_layout, gallery_layout
      FROM portfolio_subsections ORDER BY sort_order ASC, created_at ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, type, section_id, subsection_id, title, slug, excerpt, cover_media_id, visibility, status,
             published_at, created_at, updated_at, like_count, dislike_count
      FROM content
      WHERE status = 'published'
      ORDER BY published_at DESC, created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT id, section_id, name, description, sort_order, visibility
      FROM albums ORDER BY sort_order ASC, created_at ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, filename, mime_type, size_bytes, section_id, subsection_id, album_id, content_id, caption, note, kind,
             visibility, preview_object_key, created_at, updated_at
      FROM media
      WHERE kind = 'photo'
      ORDER BY created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT id, section_id, parent_id, name, description, visibility, access_mode, sort_order, archive_asset_id,
             created_at, updated_at
      FROM asset_folders ORDER BY sort_order ASC, created_at ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, folder_id, section_id, subsection_id, album_id, content_id, filename, display_name, mime_type, size_bytes, kind,
             visibility, access_mode, scope, poster_object_key,
             download_policy, relative_path, note, status, stream_uid, stream_hls_url,
             stream_dash_url, poster_url, created_at, updated_at
      FROM assets WHERE status = 'ready' ORDER BY created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT id, asset_id, label, mime_type, size_bytes, status, created_at, updated_at
      FROM asset_variants WHERE status = 'ready' ORDER BY created_at ASC
    `).all(),
    settingsObject(env),
    env.DB.prepare("SELECT content_id FROM content_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT media_id FROM media_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT section_id FROM section_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT subsection_id FROM subsection_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT album_id FROM album_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT folder_id FROM asset_folder_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT asset_id FROM asset_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
    env.DB.prepare("SELECT section_key FROM profile_section_access_users WHERE user_id = ?")
      .bind(sessionUser?.id || "").all(),
  ]);

  const ownerAccess = adminAccess || Boolean(
    sessionUser?.id && validId(settings.owner_user_id) && sessionUser.id === settings.owner_user_id,
  );
  const context = { fullAccess, adminAccess, ownerAccess };
  const allowedContentIds = new Set(rows(contentAccess).map((item) => item.content_id));
  const allowedMediaIds = new Set(rows(mediaAccess).map((item) => item.media_id));
  const allowedSectionIds = new Set(rows(sectionAccess).map((item) => item.section_id));
  const allowedSubsectionIds = new Set(rows(subsectionAccess).map((item) => item.subsection_id));
  const allowedAlbumIds = new Set(rows(albumAccess).map((item) => item.album_id));
  const allowedFolderIds = new Set(rows(folderAccess).map((item) => item.folder_id));
  const allowedAssetIds = new Set(rows(assetAccess).map((item) => item.asset_id));
  const allowedProfileSectionKeys = new Set(rows(profileSectionAccess).map((item) => item.section_key));
  const visibleProfileSections = Object.entries(PROFILE_SECTION_DEFINITIONS)
    .filter(([sectionKey, definition]) => (
      adminAccess || visibleToWebsite(
        settings[definition.visibilityKey],
        fullAccess,
        allowedProfileSectionKeys.has(sectionKey),
        ownerAccess,
      )
    ))
    .map(([sectionKey]) => sectionKey);
  const sectionRows = rows(sections).map((item) => (
    item.id === RESOURCE_SECTION_ID || item.category === "resources" ? { ...item, kind: "resources" } : item
  ));
  const visibleSections = sectionRows.filter((item) => (
    adminAccess || visibleToWebsite(item.visibility, fullAccess, allowedSectionIds.has(item.id), ownerAccess)
  ));
  const visibleSectionIds = new Set(visibleSections.map((item) => item.id));
  const gallerySectionIds = new Set(visibleSections.filter((item) => item.kind === "gallery").map((item) => item.id));
  const contentSectionIds = new Set(visibleSections.filter((item) => item.kind === "content").map((item) => item.id));
  const resourceSectionVisible = visibleSections.some(item => item.kind === "resources");
  const visibleSubsections = rows(subsections).filter((item) => (
    visibleSectionIds.has(item.section_id)
    && (adminAccess || visibleToWebsite(
      item.visibility, fullAccess, allowedSubsectionIds.has(item.id), ownerAccess,
    ))
  ));
  const visibleSubsectionIds = new Set(visibleSubsections.map((item) => item.id));
  const subsectionDownloadPolicies = new Map(rows(subsections).map((item) => [
    item.id, normalizedDownloadPolicy(item.download_policy),
  ]));
  const elevatedDownloadAccess = fullAccess || adminAccess || ownerAccess;
  const canDownloadAsset = (item) => elevatedDownloadAccess || (
    normalizedDownloadPolicy(item.download_policy) === "public"
    && (!item.subsection_id || subsectionDownloadPolicies.get(item.subsection_id) !== "member")
  );
  const visibleContent = rows(content).filter((item) => (
    visibleSectionIds.has(item.section_id)
    && (!item.subsection_id || visibleSubsectionIds.has(item.subsection_id))
    && (adminAccess || visibleToWebsite(
      item.visibility, fullAccess, allowedContentIds.has(item.id), ownerAccess,
    ))
  ));
  const visibleContentIds = new Set(visibleContent.map((item) => item.id));
  const visibleAlbums = rows(albums).filter((item) => (
    visibleSectionIds.has(item.section_id)
    && (adminAccess || visibleToWebsite(item.visibility, fullAccess, allowedAlbumIds.has(item.id), ownerAccess))
  ));
  const visibleAlbumIds = new Set(visibleAlbums.map((item) => item.id));
  // 照片自身、相册和所属大板块必须同时对当前身份可见。
  const visibleMedia = rows(media).filter((item) => (
    visibleSectionIds.has(item.section_id)
    && (!item.subsection_id || visibleSubsectionIds.has(item.subsection_id))
    && (!item.album_id || visibleAlbumIds.has(item.album_id))
    && (adminAccess || visibleToWebsite(
      item.visibility, fullAccess, allowedMediaIds.has(item.id), ownerAccess,
    ))
  ));
  const folderRows = rows(assetFolders);
  const visibleFolderIds = visibleAssetFolderIds(folderRows, context, allowedFolderIds);
  const visibleFolders = resourceSectionVisible
    ? folderRows.filter((item) => visibleFolderIds.has(item.id))
    : [];
  const variantsByAsset = new Map();
  for (const variant of rows(assetVariants)) {
    if (!variantsByAsset.has(variant.asset_id)) variantsByAsset.set(variant.asset_id, []);
    variantsByAsset.get(variant.asset_id).push(variant);
  }
  const visibleAssets = rows(assets).filter((item) => (
    (!item.folder_id || visibleFolderIds.has(item.folder_id))
    && (!item.section_id || visibleSectionIds.has(item.section_id))
    && (!item.subsection_id || visibleSubsectionIds.has(item.subsection_id))
    && (!item.album_id || visibleAlbumIds.has(item.album_id))
    && (!item.content_id || visibleContentIds.has(item.content_id))
    && (item.scope !== "library" || resourceSectionVisible)
    && (adminAccess || visibleToWebsite(
      normalizedVisibility(item.access_mode || item.visibility),
      fullAccess,
      allowedAssetIds.has(item.id),
      ownerAccess,
    ))
  ));
  const visibleAssetIds = new Set(visibleAssets.map((item) => item.id));

  const response = {
    settings: publicSettingsObject(settings, visibleProfileSections),
    access: { authenticated: Boolean(sessionUser), fullAccess, ownerAccess },
    changelogs: rows(changelogs),
    sections: visibleSections,
    subsections: visibleSubsections,
    content: visibleContent.map((item) => ({
      ...item,
      coverUrl: item.cover_media_id ? `/media/${item.cover_media_id}?preview=1` : null,
    })),
    albums: visibleAlbums,
    // 未通过审核的会话只能取得压缩预览地址，不能从接口响应中发现原片地址。
    media: visibleMedia.map((item) => mediaDto(item, { includeOriginal: fullAccess })),
    assetFolders: visibleFolders.map((folder) => ({
      ...folder,
      visibility: normalizedVisibility(folder.access_mode || folder.visibility),
      archive_asset_id: visibleAssetIds.has(folder.archive_asset_id) ? folder.archive_asset_id : null,
    })),
    /*
     * 下载权限在服务端再次核对；这里的 canDownload 只负责让前端正确显示按钮。
     * 公开下载的文件游客可下载，其余文件仅审核通过的登录用户可下载。
     */
    assets: visibleAssets.filter((item) => item.scope === "library").map((item) => assetDto(item, variantsByAsset.get(item.id) || [], {
      includeDownload: canDownloadAsset(item),
    })),
    galleryAssets: visibleAssets.filter((item) => item.scope === "gallery" && gallerySectionIds.has(item.section_id)).map((item) => assetDto(
      item, variantsByAsset.get(item.id) || [], {
        includeDownload: canDownloadAsset(item),
      },
    )),
    sectionAssets: visibleAssets.filter((item) => item.scope === "section" && contentSectionIds.has(item.section_id)).map((item) => assetDto(
      item, variantsByAsset.get(item.id) || [], {
        includeDownload: canDownloadAsset(item),
      },
    )),
    articleAssets: visibleAssets.filter((item) => item.scope === "article").map((item) => assetDto(
      item, variantsByAsset.get(item.id) || [], {
        includeDownload: canDownloadAsset(item),
      },
    )),
  };
  // Reuse this request's listing/ACL rows: do not scan all seven tables twice.
  // This also leaves headroom under D1's per-invocation query limit.
  const security = await contentSecurity(request, env, {
    context: { ...context, user: sessionUser, guestMode: Boolean(guestSession) },
    records: { section: rows(sections), subsection: rows(subsections), content: rows(content),
      media: rows(media), album: rows(albums), assetFolder: rows(assetFolders), asset: rows(assets) },
    access: [["content", contentAccess], ["media", mediaAccess], ["section", sectionAccess],
      ["subsection", subsectionAccess], ["album", albumAccess], ["assetFolder", folderAccess], ["asset", assetAccess]]
      .flatMap(([kind, result]) => rows(result).map(row => ({ kind, id: row[ACCESS_TABLES[kind].targetColumn] }))),
  });
  for (const [key, kind] of Object.entries({ sections: "section", subsections: "subsection", content: "content", media: "media",
    albums: "album", assetFolders: "assetFolder", assets: "asset", galleryAssets: "asset", sectionAssets: "asset", articleAssets: "asset" })) {
    response[key] = response[key].filter(item => security.canView(kind, item.id)).map(item => security.decorate(kind, item));
  }
  return response;
}
