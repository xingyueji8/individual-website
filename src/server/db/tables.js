/** D1 的基表和索引。旧表新增列见 structure.js。 */
export const schemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS changelogs (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS portfolio_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('content', 'gallery')),
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    show_all INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS portfolio_subsections (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    download_policy TEXT NOT NULL DEFAULT 'public'
      CHECK(download_policy IN ('public', 'member')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(section_id) REFERENCES portfolio_sections(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    preview_object_key TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    album_id TEXT,
    caption TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'photo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('article', 'guide')),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    cover_media_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    published_at TEXT,
    like_count INTEGER NOT NULL DEFAULT 0,
    dislike_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    parent_id TEXT,
    guest_name TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
    like_count INTEGER NOT NULL DEFAULT 0,
    dislike_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(content_id) REFERENCES content(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('content', 'comment')),
    target_id TEXT NOT NULL,
    value INTEGER NOT NULL CHECK(value IN (-1, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(visitor_id, target_type, target_id)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    guest_name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'message' CHECK(category IN ('message', 'bug', 'suggestion')),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'resolved')),
    is_public INTEGER NOT NULL DEFAULT 0,
    admin_reply TEXT NOT NULL DEFAULT '',
    admin_replied_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'approved', 'rejected', 'disabled')),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    last_login_at TEXT,
    last_seen_at TEXT,
    password_changed_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    contact_type TEXT NOT NULL,
    contact_value TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    invite_code TEXT NOT NULL DEFAULT '',
    review_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS content_access_users (
    content_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(content_id, user_id),
    FOREIGN KEY(content_id) REFERENCES content(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS media_access_users (
    media_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(media_id, user_id),
    FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS section_access_users (
    section_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(section_id, user_id),
    FOREIGN KEY(section_id) REFERENCES portfolio_sections(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS subsection_access_users (
    subsection_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(subsection_id, user_id),
    FOREIGN KEY(subsection_id) REFERENCES portfolio_subsections(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS album_access_users (
    album_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(album_id, user_id),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_folder_access_users (
    folder_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(folder_id, user_id),
    FOREIGN KEY(folder_id) REFERENCES asset_folders(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_access_users (
    asset_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(asset_id, user_id),
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS profile_section_access_users (
    section_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(section_key, user_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    ip_hash TEXT NOT NULL DEFAULT '',
    ip_hint TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS android_login_codes (
    code_hash TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    session_hash TEXT NOT NULL REFERENCES user_sessions(token_hash) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    access_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS login_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username_attempt TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    ip_hint TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS guest_visits (
    id TEXT PRIMARY KEY,
    visit_day TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    ip_hint TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT '',
    asn INTEGER NOT NULL DEFAULT 0,
    as_organization TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '',
    entry_count INTEGER NOT NULL DEFAULT 1,
    page_views INTEGER NOT NULL DEFAULT 1,
    last_section TEXT NOT NULL DEFAULT 'home',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(visit_day, visitor_hash)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS password_reset_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    contact_type TEXT NOT NULL,
    contact_value TEXT NOT NULL,
    token_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'approved', 'rejected', 'used', 'expired')),
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    expires_at TEXT,
    used_at TEXT,
    ip_hash TEXT NOT NULL DEFAULT '',
    ip_hint TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY,
    article_updates INTEGER NOT NULL DEFAULT 0,
    auto_open_on_login INTEGER NOT NULL DEFAULT 0,
    show_badge INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    target_url TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS private_messages (
    id TEXT PRIMARY KEY,
    sender_user_id TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'public'
      CHECK(visibility IN ('public', 'member', 'private')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    archive_asset_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(parent_id) REFERENCES asset_folders(id) ON DELETE RESTRICT
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    folder_id TEXT,
    filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'file'
      CHECK(kind IN ('file', 'pdf', 'word', 'archive', 'video', 'audio')),
    visibility TEXT NOT NULL DEFAULT 'public'
      CHECK(visibility IN ('public', 'member', 'private')),
    download_policy TEXT NOT NULL DEFAULT 'member'
      CHECK(download_policy IN ('public', 'member')),
    relative_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'uploading'
      CHECK(status IN ('uploading', 'ready', 'failed')),
    stream_uid TEXT NOT NULL DEFAULT '',
    stream_hls_url TEXT NOT NULL DEFAULT '',
    stream_dash_url TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(folder_id) REFERENCES asset_folders(id) ON DELETE RESTRICT
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_variants (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    label TEXT NOT NULL CHECK(label IN ('preview', '360p', '480p', '720p', '1080p')),
    object_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploading'
      CHECK(status IN ('uploading', 'ready', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(asset_id, label),
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_uploads (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    variant_label TEXT NOT NULL DEFAULT '',
    upload_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_name TEXT NOT NULL DEFAULT '',
    expected_size INTEGER NOT NULL DEFAULT 0,
    part_size INTEGER NOT NULL DEFAULT 33554432,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(asset_id, variant_label),
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS asset_upload_parts (
    upload_session_id TEXT NOT NULL,
    part_number INTEGER NOT NULL,
    etag TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL,
    PRIMARY KEY(upload_session_id, part_number),
    FOREIGN KEY(upload_session_id) REFERENCES asset_uploads(id) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS translations (
    source_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(source_hash, language)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS qq_webhook_events (
    event_key TEXT PRIMARY KEY,
    event_type TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL
  )
  `,
  "CREATE INDEX IF NOT EXISTS idx_content_type_status ON content(type, status, published_at)",
  "CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_media_album ON media(album_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id)",
  "CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_content_access_user ON content_access_users(user_id, content_id)",
  "CREATE INDEX IF NOT EXISTS idx_media_access_user ON media_access_users(user_id, media_id)",
  "CREATE INDEX IF NOT EXISTS idx_section_access_user ON section_access_users(user_id, section_id)",
  "CREATE INDEX IF NOT EXISTS idx_subsection_access_user ON subsection_access_users(user_id, subsection_id)",
  "CREATE INDEX IF NOT EXISTS idx_album_access_user ON album_access_users(user_id, album_id)",
  "CREATE INDEX IF NOT EXISTS idx_asset_folder_access_user ON asset_folder_access_users(user_id, folder_id)",
  "CREATE INDEX IF NOT EXISTS idx_asset_access_user ON asset_access_users(user_id, asset_id)",
  "CREATE INDEX IF NOT EXISTS idx_profile_section_access_user ON profile_section_access_users(user_id, section_key)",
  "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_user_sessions_seen ON user_sessions(last_seen_at, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_android_login_expiry ON android_login_codes(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at, revoked_at)",
  "CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_guest_visits_day ON guest_visits(visit_day, last_seen_at)",
  "CREATE INDEX IF NOT EXISTS idx_guest_visits_ip ON guest_visits(ip_hash, last_seen_at)",
  "CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_reset_requests(user_id, requested_at)",
  "CREATE INDEX IF NOT EXISTS idx_password_resets_status ON password_reset_requests(status, requested_at)",
  "CREATE INDEX IF NOT EXISTS idx_subsections_section ON portfolio_subsections(section_id, sort_order, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_private_messages_sender ON private_messages(sender_user_id, recipient_user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_private_messages_recipient ON private_messages(recipient_user_id, sender_user_id, read_at, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_asset_folders_parent ON asset_folders(parent_id, sort_order, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_assets_visibility ON assets(visibility, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_asset_variants_asset ON asset_variants(asset_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_asset_uploads_expiry ON asset_uploads(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_asset_upload_parts_session ON asset_upload_parts(upload_session_id, part_number)",
  "CREATE INDEX IF NOT EXISTS idx_qq_webhook_events_received ON qq_webhook_events(received_at)",
];
