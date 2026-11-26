/** 先建立空库需要的表，再按原有顺序为旧库补列和索引。 */
import { initializeContentSecurity } from "../content/permission-graph.js";
import { rows } from "../shared/values.js";
import { schemaStatements } from "./tables.js";

/*
 * 兼容已经在生产环境运行的旧 D1 数据库：CREATE TABLE IF NOT EXISTS 不会
 * 给旧表自动补字段，因此每次新增字段都要先读取 PRAGMA table_info，再执行
 * 一次安全的 ALTER TABLE。表名、字段名和定义均只来自本文件中的固定常量。
 */
async function ensureColumn(env, table, column, definition) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  if (rows(result).some((item) => item.name === column)) return;
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    /*
     * Cloudflare 可能同时启动多个 Worker 实例：两个实例都先看到字段不存在，
     * 随后只有第一个 ALTER 成功。第二个收到 duplicate column 时重新核对表结构；
     * 字段确实已经建立就视为成功，其余数据库错误仍原样抛出。
     */
    const current = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    if (rows(current).some((item) => item.name === column)) return;
    throw error;
  }
}

export async function prepareStructure(env) {
  /*
   * D1 的 exec() 会把传入文本按换行拆成多条 SQL。建表语句本身是多行时，
   * 第一行 "CREATE TABLE ... (" 会被单独执行，从而报 incomplete input。
   * 因此这里把每张表和每个索引定义成一条完整的 PreparedStatement，再由
   * batch() 按顺序执行。SQL 仍保留多行排版，方便以后查找和修改字段。
   */
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));

  // 旧站数据迁移：为文章、相册和图片补上所属“个人空间板块”。
  for (const [table, column, definition] of [
    ["content", "section_id", "TEXT"],
    ["albums", "section_id", "TEXT"],
    ["media", "section_id", "TEXT"],
    ["media", "subsection_id", "TEXT"],
    ["media", "visibility", "TEXT NOT NULL DEFAULT 'public'"],
    ["media", "preview_object_key", "TEXT"],
    ["portfolio_sections", "visibility", "TEXT NOT NULL DEFAULT 'public'"],
    ["portfolio_subsections", "visibility", "TEXT NOT NULL DEFAULT 'public'"],
    ["portfolio_subsections", "download_policy", "TEXT NOT NULL DEFAULT 'public'"],
    ["portfolio_sections", "category", "TEXT"],
    ["portfolio_sections", "download_policy", "TEXT NOT NULL DEFAULT 'public'"],
    ["portfolio_subsections", "parent_id", "TEXT"],
    ["portfolio_sections", "article_layout", "TEXT NOT NULL DEFAULT 'article'"],
    ["portfolio_sections", "gallery_layout", "TEXT NOT NULL DEFAULT 'grid'"],
    ["portfolio_subsections", "article_layout", "TEXT NOT NULL DEFAULT 'inherit'"],
    ["portfolio_subsections", "gallery_layout", "TEXT NOT NULL DEFAULT 'inherit'"],
    ["media", "content_id", "TEXT"],
    ["media", "note", "TEXT NOT NULL DEFAULT ''"],
    ["media", "sha256", "TEXT"],
    ["media", "mosaic_object_key", "TEXT"],
    ["media", "upload_token", "TEXT"],
  ]) await ensureColumn(env, table, column, definition);
  await initializeContentSecurity(env);
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_media_hash ON media(sha256)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_media_upload_token ON media(upload_token)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS photo_upload_cancellations(token TEXT PRIMARY KEY,created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_subsection_parent ON portfolio_subsections(parent_id)"),
    env.DB.prepare("DELETE FROM content_grants WHERE expires_at <= ?").bind(Date.now()),
  ]);
  for (const [table, column, definition] of [
    ["albums", "visibility", "TEXT NOT NULL DEFAULT 'public'"],
    ["content", "visibility", "TEXT NOT NULL DEFAULT 'public'"],
    ["content", "subsection_id", "TEXT"],
    ["comments", "author_user_id", "TEXT"],
    ["comments", "is_admin", "INTEGER NOT NULL DEFAULT 0"],
    ["comments", "is_pinned", "INTEGER NOT NULL DEFAULT 0"],
    ["comments", "author_liked", "INTEGER NOT NULL DEFAULT 0"],
    ["changelogs", "sort_order", "INTEGER NOT NULL DEFAULT 0"],
    ["assets", "section_id", "TEXT"],
    ["assets", "subsection_id", "TEXT"],
    ["assets", "album_id", "TEXT"],
    ["assets", "access_mode", "TEXT NOT NULL DEFAULT 'public'"],
    ["assets", "scope", "TEXT NOT NULL DEFAULT 'library'"],
    ["assets", "content_id", "TEXT"],
    ["assets", "poster_object_key", "TEXT"],
    ["assets", "note", "TEXT NOT NULL DEFAULT ''"],
    ["asset_uploads", "part_size", "INTEGER NOT NULL DEFAULT 33554432"],
    ["asset_uploads", "file_name", "TEXT NOT NULL DEFAULT ''"],
    ["asset_folders", "access_mode", "TEXT NOT NULL DEFAULT 'public'"],
    ["asset_folders", "section_id", "TEXT NOT NULL DEFAULT 'section-resources'"],
    ["user_profiles", "admin_note", "TEXT NOT NULL DEFAULT ''"],
  ]) await ensureColumn(env, table, column, definition);
  // 留言只能由 Studio 中已验证的站长回复；旧数据库会在这里安全补齐字段。
  for (const [table, column, definition] of [
    ["feedback", "admin_reply", "TEXT NOT NULL DEFAULT ''"],
    ["feedback", "admin_replied_at", "TEXT"],
  ]) await ensureColumn(env, table, column, definition);
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_content_section ON content(section_id, status, published_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_albums_section ON albums(section_id, sort_order)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_media_section ON media(section_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_media_subsection ON media(subsection_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sections_visibility ON portfolio_sections(visibility, sort_order)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_content_visibility ON content(visibility, status, published_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_content_subsection ON content(subsection_id, published_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_user_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assets_gallery ON assets(section_id, album_id, status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assets_scope ON assets(scope, content_id, status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_assets_subsection ON assets(subsection_id, status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_comments_pinned ON comments(content_id, is_pinned, created_at)"),
  ]);
}
