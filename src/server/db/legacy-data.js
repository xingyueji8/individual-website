/** 保留历史迁移标记、初始化顺序和 D1/R2 资源归属规则。 */
import { inlineMediaIdsFromHtml, migrateLegacyEmbeddedArticleAssets } from "../content/article-attachments.js";
import { APP_VERSION } from "../http/responses.js";
import { RESOURCE_SECTION_ID } from "../shared/config.js";
import { rows } from "../shared/values.js";

export async function migrateLegacyData(env, timestamp) {
  /*
   * 旧版文章允许从通用文件库插入资源，正文仍完整保存 data-resource-id，
   * 但这些文件没有 content_id。资源域收紧后，它们因此只出现在文件管理中，
   * 文章卡片却无法解析。这里只修复正文明确引用的文件元数据，不移动、复制或
   * 删除任何 R2 对象；迁移标记保证生产数据库只扫描一次。
   */
  const articleAssetMigration = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'legacy_article_embeds_migrated_v2'",
  ).first();
  if (!articleAssetMigration) {
    await migrateLegacyEmbeddedArticleAssets(env, timestamp);
    await env.DB.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    `).bind("legacy_article_embeds_migrated_v2", "1", timestamp).run();
  }

  /*
   * 三类资源域严格按所属大板块归档。旧逻辑只判断 section_id 是否为空，
   * 会把文件资源误归进图片板块；这里按真实板块类型修正，并保证独立文件库
   * 永远只属于固定的“文件资源”板块。
   */
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE assets SET access_mode = visibility
      WHERE access_mode IS NULL OR access_mode = ''
        OR (access_mode = 'public' AND visibility IN ('member', 'private'))
    `),
    env.DB.prepare(`
      UPDATE asset_folders SET access_mode = visibility
      WHERE access_mode IS NULL OR access_mode = ''
        OR (access_mode = 'public' AND visibility IN ('member', 'private'))
    `),
    env.DB.prepare(`
      UPDATE assets SET scope = 'library', section_id = ?
      WHERE section_id = ? AND COALESCE(scope, 'library') <> 'article'
    `).bind(RESOURCE_SECTION_ID, RESOURCE_SECTION_ID),
    env.DB.prepare(`
      UPDATE assets SET scope = 'gallery'
      WHERE section_id IN (SELECT id FROM portfolio_sections WHERE kind = 'gallery')
        AND COALESCE(scope, 'library') <> 'article'
    `),
    env.DB.prepare(`
      UPDATE assets SET scope = 'section'
      WHERE section_id IN (SELECT id FROM portfolio_sections WHERE kind = 'content' AND id <> ?)
        AND COALESCE(scope, 'library') NOT IN ('article', 'section')
    `).bind(RESOURCE_SECTION_ID),
    env.DB.prepare("UPDATE assets SET section_id = ? WHERE COALESCE(scope, 'library') = 'library'")
      .bind(RESOURCE_SECTION_ID),
    env.DB.prepare(`
      UPDATE assets
      SET section_id = (SELECT section_id FROM content WHERE content.id = assets.content_id),
          subsection_id = (SELECT subsection_id FROM content WHERE content.id = assets.content_id)
      WHERE scope = 'article' AND content_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM content WHERE content.id = assets.content_id)
    `),
  ]);

  /*
   * 旧相册只迁移一次为统一小板块，并沿用原 ID 与权限。之后图片、文章、文件
   * 都通过 portfolio_subsections 管理，旧相册表仅保留读取兼容，不再作为新结构。
   */
  const unifiedSubsectionMarker = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'unified_subsections_initialized'",
  ).first();
  if (!unifiedSubsectionMarker) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO portfolio_subsections
          (id, section_id, name, description, sort_order, visibility, created_at, updated_at)
        SELECT id, section_id, name, description, sort_order, visibility, created_at, updated_at
        FROM albums WHERE section_id IS NOT NULL
      `),
      env.DB.prepare(`
        INSERT OR IGNORE INTO subsection_access_users (subsection_id, user_id, created_at)
        SELECT album_id, user_id, created_at FROM album_access_users
      `),
      env.DB.prepare("UPDATE media SET subsection_id = album_id WHERE album_id IS NOT NULL AND subsection_id IS NULL"),
      env.DB.prepare("UPDATE assets SET subsection_id = album_id WHERE album_id IS NOT NULL AND subsection_id IS NULL"),
      env.DB.prepare("UPDATE media SET album_id = NULL WHERE subsection_id IS NOT NULL AND album_id = subsection_id"),
      env.DB.prepare("UPDATE assets SET album_id = NULL WHERE subsection_id IS NOT NULL AND album_id = subsection_id"),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('unified_subsections_initialized', '1', ?)")
        .bind(timestamp),
    ]);
  }

  /*
   * 删除旧版本自动写入的默认主页副标题。只清理这两个完全匹配的旧默认值，
   * 不会覆盖站长已经在后台填写过的其他自定义介绍。
   */
  await env.DB.prepare(`
    UPDATE settings
    SET value = '', updated_at = ?
    WHERE key = 'intro'
      AND value IN ('这里是星月集的个人网站。', '这里是星月集的个人网站')
  `).bind(timestamp).run();

  /*
   * 初次升级时创建三个默认大板块。初始化标记会永久保留，因此站长日后把
   * 默认板块全部删除后，Worker 不会在下一次冷启动时偷偷把它们建回来。
   */
  const sectionMarker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'portfolio_sections_initialized'").first();
  if (!sectionMarker) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO portfolio_sections
          (id, name, kind, description, sort_order, show_all, created_at, updated_at)
        VALUES (?, ?, 'content', ?, 0, 1, ?, ?)
      `).bind("section-essays", "随笔", "文章与生活随笔", timestamp, timestamp),
      env.DB.prepare(`
        INSERT OR IGNORE INTO portfolio_sections
          (id, name, kind, description, sort_order, show_all, created_at, updated_at)
        VALUES (?, ?, 'gallery', ?, 10, 1, ?, ?)
      `).bind("section-photos", "拍摄照片", "按小板块浏览图片、文件与视频", timestamp, timestamp),
      env.DB.prepare(`
        INSERT OR IGNORE INTO portfolio_sections
          (id, name, kind, description, sort_order, show_all, created_at, updated_at)
        VALUES (?, ?, 'content', ?, 20, 1, ?, ?)
      `).bind("section-guides", "北京旅行指南", "北京旅行内容", timestamp, timestamp),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('portfolio_sections_initialized', '1', ?)")
        .bind(timestamp),
    ]);
  }

  /* 文件资源是个人空间中的固定大板块，权限与“全部”开关也由同一后台表单管理。 */
  await env.DB.prepare(`
    INSERT OR IGNORE INTO portfolio_sections
      (id, name, kind, description, sort_order, show_all, visibility, created_at, updated_at)
    VALUES (?, '文件资源', 'content', '独立上传的文件、文档与视频', 30, 1, 'public', ?, ?)
  `).bind(RESOURCE_SECTION_ID, timestamp, timestamp).run();

  const albumMarker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'albums_initialized'").first();
  if (!albumMarker) {
    const albumCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM albums").first();
    if (!Number(albumCount?.count)) {
      const defaultAlbumId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO albums (id, name, description, sort_order, created_at, updated_at, section_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(defaultAlbumId, "随手拍", "记录生活中的片段", 0, timestamp, timestamp, "section-photos"),
        env.DB.prepare(`
          INSERT OR IGNORE INTO portfolio_subsections
            (id, section_id, name, description, sort_order, visibility, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, 'public', ?, ?)
        `).bind(defaultAlbumId, "section-photos", "随手拍", "记录生活中的片段", timestamp, timestamp),
      ]);
    }
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('albums_initialized', '1', ?)")
      .bind(timestamp).run();
  }

  const changelogMarker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'changelogs_initialized'").first();
  if (!changelogMarker) {
    const changelogCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM changelogs").first();
    if (!Number(changelogCount?.count)) {
      await env.DB.prepare(
        "INSERT INTO changelogs (id, version, title, body, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        "1.8.8.0",
        "全站功能升级",
        "新增版本更新说明、作品集专栏、游客评论与反应功能，并为后续后台发布系统做好准备。",
        timestamp,
        timestamp,
        timestamp,
      ).run();
    }
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('changelogs_initialized', '1', ?)")
      .bind(timestamp).run();
  }

  /*
   * 早期初始化脚本曾把系统默认日志写成 2.0.0，而网站实际版本以 1.8.8.0 为准。
   * 这里同时匹配旧版本、标题和正文，只迁移那条系统默认数据，不会改动站长自建日志。
   */
  await env.DB.prepare(`
    UPDATE changelogs
    SET version = ?, updated_at = ?
    WHERE version = ? AND title = ? AND body = ?
  `).bind(
    "1.8.8.0",
    timestamp,
    "2.0.0",
    "全站功能升级",
    "新增版本更新说明、作品集专栏、游客评论与反应功能，并为后续后台发布系统做好准备。",
  ).run();

  /*
   * 本次文件存储与夜览升级只追加一次独立日志。标记写入 settings 后，Worker
   * 冷启动或多次部署都不会重复创建；站长仍可在 Studio 中编辑或删除这条记录。
   */
  const mediaThemeMarker = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'media_theme_upgrade_initialized'",
  ).first();
  if (!mediaThemeMarker) {
    // 全新数据库中默认日志与升级日志会在同一毫秒创建；稍后 1ms 保证排序稳定。
    const mediaThemePublishedAt = new Date(Date.now() + 1).toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO changelogs (id, version, title, body, published_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        APP_VERSION,
        "文件资源库与白天/夜览模式",
        "新增 R2 大文件与文件夹分片上传、PDF/Word 在线预览、视频播放与清晰度版本、文章资源内嵌；新增白天、夜览和跟随系统三种全站主题。",
        mediaThemePublishedAt,
        timestamp,
        timestamp,
      ),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('media_theme_upgrade_initialized', '1', ?)")
        .bind(timestamp),
      env.DB.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('site_version', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(APP_VERSION, timestamp),
    ]);
  }

  /* 2.2 社区与界面升级只登记一次，并把页脚版本同步到本次发布。 */
  const communityUiMarker = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'community_ui_2_2_initialized'",
  ).first();
  if (!communityUiMarker) {
    const publishedAt = new Date(Date.now() + 2).toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO changelogs
          (id, version, title, body, published_at, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 220, ?, ?)
      `).bind(
        crypto.randomUUID(), APP_VERSION, "多彩界面、通知私信与个人空间升级",
        "统一登录与注册液态玻璃，优化移动顶栏和侧栏回弹；新增个人空间小板块、图片板块视频、通知信箱、用户私信、站长评论回复及精确更新日志排序。",
        publishedAt, timestamp, timestamp,
      ),
      env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('community_ui_2_2_initialized', '1', ?)")
        .bind(timestamp),
      env.DB.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('site_version', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(APP_VERSION, timestamp),
    ]);
  }

  // 把旧数据映射到新的动态板块，已设置过 section_id 的记录不会被覆盖。
  await env.DB.batch([
    env.DB.prepare("UPDATE content SET section_id = 'section-guides' WHERE section_id IS NULL AND type = 'guide'"),
    env.DB.prepare("UPDATE content SET section_id = 'section-essays' WHERE section_id IS NULL AND type = 'article'"),
    env.DB.prepare("UPDATE albums SET section_id = 'section-photos' WHERE section_id IS NULL"),
    env.DB.prepare("UPDATE media SET section_id = 'section-photos' WHERE section_id IS NULL AND kind = 'photo'"),
  ]);

  // 页脚版本号默认跟随最新一条更新记录，以后每次后台保存日志都会同步更新。
  const latestLog = await env.DB.prepare(
    "SELECT version FROM changelogs ORDER BY sort_order DESC, published_at DESC, created_at DESC LIMIT 1",
  ).first();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('site_version', ?, ?)")
    .bind(latestLog?.version || APP_VERSION, timestamp).run();

  const inlineMarker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'inline_ownership_initialized'").first();
  if (!inlineMarker) {
    const articles = rows(await env.DB.prepare("SELECT id,section_id,subsection_id,body_html FROM content ORDER BY updated_at DESC").all());
    const claims = new Map();
    for (const article of articles) for (const mediaId of inlineMediaIdsFromHtml(article.body_html)) {
      if (!claims.has(mediaId)) claims.set(mediaId, { id: mediaId, contentId: article.id, sectionId: article.section_id, subsectionId: article.subsection_id || null });
    }
    const ownership = [...claims.values()];
    for (let offset = 0; offset < ownership.length; offset += 500) {
      await env.DB.prepare(`WITH owners AS (SELECT value FROM json_each(?))
        UPDATE media SET
          content_id=(SELECT json_extract(value,'$.contentId') FROM owners WHERE json_extract(value,'$.id')=media.id),
          section_id=(SELECT json_extract(value,'$.sectionId') FROM owners WHERE json_extract(value,'$.id')=media.id),
          subsection_id=(SELECT json_extract(value,'$.subsectionId') FROM owners WHERE json_extract(value,'$.id')=media.id)
        WHERE kind='inline' AND content_id IS NULL AND id IN (SELECT json_extract(value,'$.id') FROM owners)`)
        .bind(JSON.stringify(ownership.slice(offset, offset + 500))).run();
    }
    await env.DB.prepare("INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES('inline_ownership_initialized','1',?)").bind(timestamp).run();
  }
}
