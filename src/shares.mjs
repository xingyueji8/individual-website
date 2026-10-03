// A share is a snapshot of explicitly chosen works, never a website session.
// Database triggers revoke it in the same write that withdraws permissions.
import { SECURITY_TABLES } from "./content-security.mjs";

const columns = {
  section: "id,name,visibility,download_policy,updated_at",
  subsection: "id,name,description,section_id,parent_id,visibility,download_policy,updated_at",
  content: "id,title,section_id,subsection_id,visibility,status,body_html,cover_media_id,updated_at",
  media: "id,filename,caption,section_id,subsection_id,album_id,content_id,kind,visibility,updated_at",
  asset: "id,display_name,section_id,subsection_id,album_id,content_id,folder_id,scope,status,visibility,access_mode,download_policy,updated_at",
  assetFolder: "id,section_id,parent_id,visibility,access_mode,updated_at",
  album: "id,section_id,visibility,updated_at",
};
const key = (kind, id) => `${kind}:${id}`;
const resultRows = result => result.results || [];
const tokenPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;

export async function initializeShares(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS share_links (
      token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL,
      state TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL,
      activated_at INTEGER, prepare_expires_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS share_targets (
      token_hash TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, role TEXT NOT NULL,
      PRIMARY KEY(token_hash,kind,target_id))`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_share_target ON share_targets(kind,target_id)"),
  ]);
  const statements = [];
  for (const [kind, table] of Object.entries(SECURITY_TABLES)) {
    const watched = columns[kind].split(",").filter(name => !["id", "name", "description", "title", "filename", "caption", "display_name", "body_html", "cover_media_id", "updated_at"].includes(name));
    const changed = watched.map(name => `OLD.${name} IS NOT NEW.${name}`).join(" OR ");
    statements.push(env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS share_${kind}_update AFTER UPDATE ON ${table}
      WHEN (${changed}) OR OLD.updated_at IS NOT NEW.updated_at BEGIN
      UPDATE share_links SET state='revoked' WHERE state IN ('active','pending')
        AND (state='pending' OR (${changed})) AND token_hash IN
        (SELECT token_hash FROM share_targets WHERE kind='${kind}' AND target_id=OLD.id); END`));
    statements.push(env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS share_${kind}_delete AFTER DELETE ON ${table} BEGIN
      UPDATE share_links SET state='revoked' WHERE state IN ('active','pending') AND token_hash IN
        (SELECT token_hash FROM share_targets WHERE kind='${kind}' AND target_id=OLD.id); END`));
  }
  for (const table of ["download_rules", "content_locks"]) {
    for (const action of ["INSERT", "UPDATE", "DELETE"]) {
      const row = action === "DELETE" ? "OLD" : "NEW";
      const condition = action !== "UPDATE" ? "" : table === "download_rules"
        ? "WHEN OLD.mode IS NOT NEW.mode OR OLD.user_ids IS NOT NEW.user_ids"
        : "WHEN OLD.enabled IS NOT NEW.enabled OR OLD.version IS NOT NEW.version";
      statements.push(env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS share_${table}_${action.toLowerCase()}
        AFTER ${action} ON ${table} ${condition} BEGIN
        UPDATE share_links SET state='revoked' WHERE state IN ('active','pending') AND token_hash IN
          (SELECT token_hash FROM share_targets WHERE kind=${row}.target_kind AND target_id=${row}.target_id); END`));
    }
  }
  await env.DB.batch(statements);
}

async function graph(env, targets = null) {
  const entries = Object.entries(SECURITY_TABLES);
  const results = await Promise.all(entries.map(([kind, table]) => targets
    ? env.DB.prepare(`SELECT ${columns[kind]} FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(targets.filter(t => t.kind === kind).map(t => t.id))).all()
    : env.DB.prepare(`SELECT ${columns[kind]} FROM ${table}`).all()));
  const records = new Map();
  entries.forEach(([kind], index) => resultRows(results[index]).forEach(item => records.set(key(kind, item.id), { ...item, kindName: kind })));
  return records;
}

function parents(item) {
  const output = [];
  if (item.section_id) output.push(["section", item.section_id]);
  if (item.parent_id) output.push([item.kindName === "assetFolder" ? "assetFolder" : "subsection", item.parent_id]);
  if (item.subsection_id) output.push(["subsection", item.subsection_id]);
  if (item.album_id) output.push(["album", item.album_id]);
  if (item.content_id) output.push(["content", item.content_id]);
  if (item.folder_id) output.push(["assetFolder", item.folder_id]);
  return output;
}

async function planShare(env, kind, id, hooks) {
  if (!["content", "media", "asset", "subsection"].includes(kind) || typeof id !== "string" || !idPattern.test(id)) throw hooks.error(400, "请选择文章、图片、文件或小板块");
  const records = await graph(env);
  const root = records.get(key(kind, id));
  if (!root) throw hooks.error(404, "要分享的内容不存在");
  if (kind === "content" && root.status !== "published") throw hooks.error(409, "请先保存并发布文章，再分享浏览链接");
  if (kind === "media" && (root.kind !== "photo" || root.content_id)) throw hooks.error(400, "文章插图请随所属文章分享");
  if (kind === "asset" && root.status !== "ready") throw hooks.error(409, "请等待文件上传完成再分享");
  const targets = new Map();
  function add(item, role) {
    if (!item) return;
    const k = key(item.kindName, item.id);
    const rank = { item: 3, resource: 2, guard: 1 };
    if ((rank[targets.get(k)?.role] || 0) < rank[role]) targets.set(k, { kind: item.kindName, id: item.id, role });
  }
  add(root, "item");
  if (kind === "subsection") {
    const ids = new Set([id]);
    let more = true;
    while (more) {
      more = false;
      for (const item of records.values()) if (item.kindName === "subsection" && item.section_id === root.section_id && ids.has(item.parent_id) && !ids.has(item.id)) {
        ids.add(item.id); add(item, "item"); more = true;
      }
    }
    for (const item of records.values()) if (item.section_id === root.section_id && ids.has(item.subsection_id)) {
      if (item.kindName === "content" && item.status === "published"
        || item.kindName === "media" && item.kind === "photo" && !item.content_id
        || item.kindName === "asset" && item.status === "ready" && !item.content_id) add(item, "item");
    }
  }
  // Only article-owned resources and a cover from the same location belong to
  // its scope. Referencing a private resource in another board never publishes it.
  for (const target of [...targets.values()]) if (target.kind === "content") {
    const article = records.get(key("content", target.id));
    for (const item of records.values()) if (item.content_id === article.id && (
      item.kindName === "media" || item.kindName === "asset" && item.status === "ready")) add(item, "resource");
    const cover = records.get(key("media", article.cover_media_id));
    if (cover && (!cover.content_id || cover.content_id === article.id)
      && cover.section_id === article.section_id && (cover.subsection_id || null) === (article.subsection_id || null)) add(cover, "resource");
  }
  // Keep outside ancestors as revocation guards, without granting or publishing them.
  function ancestors(item, trail = new Set()) {
    const current = key(item.kindName, item.id);
    if (trail.has(current)) throw hooks.error(409, "内容层级存在循环，请先修复层级");
    trail.add(current);
    for (const [pk, pid] of parents(item)) {
      const parent = records.get(key(pk, pid));
      if (!parent) throw hooks.error(409, "内容所属层级不存在，请先保存正确的归属");
      if (!targets.has(key(pk, pid))) add(parent, "guard");
      ancestors(parent, new Set(trail));
    }
  }
  for (const target of [...targets.values()]) ancestors(records.get(key(target.kind, target.id)));
  const list = [...targets.values()].sort((a, b) => key(a.kind, a.id).localeCompare(key(b.kind, b.id)));
  if (list.length > 5000) throw hooks.error(400, "此板块内容较多，请选择更小的板块分享");
  const policy = await Promise.all([
    env.DB.prepare("SELECT * FROM download_rules ORDER BY target_kind,target_id").all(),
    env.DB.prepare("SELECT target_kind,target_id,enabled,version FROM content_locks ORDER BY target_kind,target_id").all(),
  ]);
  const fingerprint = await hooks.hash(JSON.stringify({
    targets: list.map(target => ({ ...target, record: records.get(key(target.kind, target.id)) })),
    policy: policy.map(result => resultRows(result).filter(item => targets.has(key(item.target_kind, item.target_id)))),
  }));
  return { list, fingerprint, title: root.title || root.caption || root.filename || root.display_name || root.name,
    summary: Object.fromEntries(["content", "media", "asset", "subsection"].map(k => [k, list.filter(t => t.kind === k && t.role !== "guard").length])) };
}

export async function adminShares(request, env, token, action, hooks) {
  if (request.method !== "POST") throw hooks.error(405, "不支持的请求方法");
  if (!token) {
    const input = await hooks.readJson(request);
    const plan = await planShare(env, input.kind, input.id, hooks);
    const value = hooks.token();
    const hash = await hooks.hash(value);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM share_targets WHERE token_hash IN (SELECT token_hash FROM share_links WHERE state!='active' AND prepare_expires_at<?)").bind(Date.now() - 86400000),
      env.DB.prepare("DELETE FROM share_links WHERE state!='active' AND prepare_expires_at<?").bind(Date.now() - 86400000),
      env.DB.prepare(`INSERT INTO share_links(token_hash,kind,target_id,state,fingerprint,created_at,prepare_expires_at)
        VALUES(?,?,?,'pending',?,?,?)`).bind(hash, input.kind, input.id, plan.fingerprint, Date.now(), Date.now() + 10 * 60 * 1000),
      env.DB.prepare(`INSERT INTO share_targets(token_hash,kind,target_id,role)
        SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.role') FROM json_each(?)`)
        .bind(hash, JSON.stringify(plan.list)),
    ]);
    return { token: value, url: `${new URL(request.url).origin}/share/${value}`, title: plan.title, summary: plan.summary };
  }
  if (!tokenPattern.test(token) || action !== "activate") throw hooks.error(400, "分享参数无效");
  const hash = await hooks.hash(token);
  const share = await env.DB.prepare("SELECT * FROM share_links WHERE token_hash=?").bind(hash).first();
  if (!share || !["pending", "active"].includes(share.state)) throw hooks.error(410, "分享已失效，请重新复制链接");
  if (share.state === "active") return { ok: true, targets: resultRows(await env.DB.prepare("SELECT kind,target_id AS id,role FROM share_targets WHERE token_hash=? AND role!='guard'").bind(hash).all()) };
  if (share.prepare_expires_at < Date.now()) throw hooks.error(410, "复制窗口已过期，请重新打开分享窗口");
  const plan = await planShare(env, share.kind, share.target_id, hooks);
  if (plan.fingerprint !== share.fingerprint) throw hooks.error(409, "内容或权限已经改变，请重新打开分享窗口");
  const active = "EXISTS (SELECT 1 FROM share_links WHERE token_hash=? AND state='activating')";
  const ids = "SELECT target_id FROM share_targets WHERE token_hash=? AND kind=? AND role!='guard'";
  const statements = [env.DB.prepare("UPDATE share_links SET state='activating' WHERE token_hash=? AND state='pending' AND prepare_expires_at>?").bind(hash, Date.now())];
  for (const kind of ["subsection", "content", "media", "asset"]) {
    const updates = ["visibility='public'"];
    if (kind === "asset") updates.push("access_mode='public'");
    if (["subsection", "asset"].includes(kind)) updates.push("download_policy='public'");
    statements.push(env.DB.prepare(`UPDATE ${SECURITY_TABLES[kind]} SET ${updates.join(",")} WHERE id IN (${ids}) AND ${active}`).bind(hash, kind, hash));
    const config = hooks.accessTables[kind];
    statements.push(env.DB.prepare(`DELETE FROM ${config.table} WHERE ${config.targetColumn} IN (${ids}) AND ${active}`).bind(hash, kind, hash));
  }
  statements.push(env.DB.prepare(`DELETE FROM content_locks WHERE (target_kind,target_id) IN
    (SELECT kind,target_id FROM share_targets WHERE token_hash=? AND role!='guard') AND ${active}`).bind(hash, hash));
  statements.push(env.DB.prepare(`DELETE FROM content_grants WHERE (target_kind,target_id) IN
    (SELECT kind,target_id FROM share_targets WHERE token_hash=? AND role!='guard') AND ${active}`).bind(hash, hash));
  // Boards/files already have a download-policy field in Studio. Remove their
  // explicit overrides so changing that field later really withdraws download.
  statements.push(env.DB.prepare(`DELETE FROM download_rules WHERE target_kind IN ('subsection','asset') AND (target_kind,target_id) IN
    (SELECT kind,target_id FROM share_targets WHERE token_hash=? AND role!='guard') AND ${active}`).bind(hash, hash));
  statements.push(env.DB.prepare(`INSERT INTO download_rules(target_kind,target_id,mode,user_ids,updated_at)
    SELECT kind,target_id,'public','[]',? FROM share_targets WHERE token_hash=? AND kind IN ('content','media') AND role!='guard' AND ${active}
    ON CONFLICT(target_kind,target_id) DO UPDATE SET mode='public',user_ids='[]',updated_at=excluded.updated_at`).bind(new Date().toISOString(), hash, hash));
  statements.push(env.DB.prepare("UPDATE share_links SET state='active',activated_at=? WHERE token_hash=? AND state='activating'").bind(Date.now(), hash));
  // The intermediate state and all permission changes are one D1 transaction.
  await env.DB.batch(statements);
  if ((await env.DB.prepare("SELECT state FROM share_links WHERE token_hash=?").bind(hash).first())?.state !== "active") throw hooks.error(410, "内容已改变，分享未生效，请重新复制");
  return { ok: true, targets: plan.list.filter(item => item.role !== "guard") };
}

export async function resolveShare(env, token, hooks) {
  const invalid = () => hooks.error(410, "分享链接已失效，或站长已收回浏览／下载权限");
  if (!tokenPattern.test(token || "")) throw invalid();
  const hash = await hooks.hash(token);
  const share = await env.DB.prepare("SELECT kind,target_id,state FROM share_links WHERE token_hash=?").bind(hash).first();
  if (!share || share.state !== "active") throw invalid();
  const targets = resultRows(await env.DB.prepare("SELECT kind,target_id AS id,role FROM share_targets WHERE token_hash=? AND role!='guard'").bind(hash).all());
  // Defence in depth: every read rechecks current policy, even if a future admin
  // path accidentally bypasses the revocation triggers.
  const records = await graph(env, targets);
  const [downloads, locks] = await Promise.all([
    env.DB.prepare(`SELECT r.target_kind,r.target_id,r.mode FROM download_rules r JOIN share_targets t
      ON r.target_kind=t.kind AND r.target_id=t.target_id WHERE t.token_hash=?`).bind(hash).all(),
    env.DB.prepare(`SELECT r.target_kind,r.target_id FROM content_locks r JOIN share_targets t
      ON r.target_kind=t.kind AND r.target_id=t.target_id WHERE t.token_hash=? AND r.enabled=1`).bind(hash).all(),
  ]);
  const policies = new Map(resultRows(downloads).map(item => [key(item.target_kind, item.target_id), item.mode]));
  const locked = new Set(resultRows(locks).map(item => key(item.target_kind, item.target_id)));
  if (!targets.length || targets.some(target => {
    const k = key(target.kind, target.id), item = records.get(k);
    const download = policies.get(k) || (["subsection", "asset"].includes(target.kind) ? item?.download_policy : "member");
    return !item || (item.access_mode || item.visibility) !== "public" || download !== "public" || locked.has(k)
      || target.kind === "content" && item.status !== "published" || target.kind === "asset" && item.status !== "ready";
  })) {
    await env.DB.prepare("UPDATE share_links SET state='revoked' WHERE token_hash=?").bind(hash).run();
    throw invalid();
  }
  const membership = new Set(targets.map(target => key(target.kind, target.id)));
  return { ...share, token, hash, targets, records, has: (kind, id) => membership.has(key(kind, id)),
    require(kind, id) { if (!membership.has(key(kind, id))) throw hooks.error(404, "此内容不在当前分享范围内"); } };
}

export async function sharedContent(request, env, share, id, hooks) {
  share.require("content", id);
  const item = await env.DB.prepare("SELECT id,title,excerpt,body_html,published_at,updated_at FROM content WHERE id=? AND status='published'").bind(id).first();
  if (!item) throw hooks.error(410, "文章已撤回");
  const prefix = `/api/shares/${share.token}`;
  const rewritten = new HTMLRewriter().on("img", {
    element(element) {
      let source;
      try { source = new URL(element.getAttribute("src") || "", request.url); } catch { element.remove(); return; }
      if (source.origin !== new URL(request.url).origin) { element.setAttribute("referrerpolicy", "no-referrer"); return; }
      const mediaId = source.pathname.match(/^\/media\/([a-zA-Z0-9_-]{1,80})$/)?.[1];
      if (!mediaId || !share.has("media", mediaId)) { element.setAttribute("src", "/protected-image.svg"); element.setAttribute("alt", "此图片未包含在分享中"); }
      else element.setAttribute("src", `${prefix}/media/${mediaId}?preview=1`);
      element.removeAttribute("srcset");
    },
  }).on(".resource-embed", {
    element(element) {
      if (element.getAttribute("data-resource-type") !== "asset" || !share.has("asset", element.getAttribute("data-resource-id"))) {
        element.removeAttribute("data-resource-id"); element.setInnerContent("此附件未包含在分享中");
      }
    },
  }).transform(new Response(hooks.sanitize(item.body_html)));
  return { ...item, body_html: await rewritten.text(), canDownload: true };
}

export async function shareListing(env, share) {
  const prefix = `/api/shares/${share.token}`;
  const selected = kind => share.targets.filter(target => target.kind === kind && target.role === "item");
  const boards = new Set(selected("subsection").map(target => target.id));
  const boardId = id => boards.has(id) ? id : null;
  const content = selected("content").map(target => {
    const item = share.records.get(key("content", target.id));
    return { id: item.id, title: item.title, subsectionId: boardId(item.subsection_id), updatedAt: item.updated_at };
  });
  const media = share.targets.filter(target => target.kind === "media").map(target => {
    const item = share.records.get(key("media", target.id));
    return { id: item.id, title: item.caption || item.filename, role: target.role, subsectionId: boardId(item.subsection_id),
      url: `${prefix}/media/${item.id}?preview=1`, downloadUrl: `${prefix}/media/${item.id}?download=1` };
  });
  const assetRows = resultRows(await env.DB.prepare(`SELECT a.id,a.display_name,a.mime_type,a.kind,a.size_bytes,a.content_id,a.subsection_id,a.poster_object_key
    FROM assets a JOIN share_targets t ON t.kind='asset' AND t.target_id=a.id
    WHERE t.token_hash=? AND t.role!='guard' AND a.status='ready'`).bind(share.hash).all());
  const assets = assetRows.map(item => ({ id: item.id, title: item.display_name, mimeType: item.mime_type, kind: item.kind,
    sizeBytes: item.size_bytes, contentId: share.has("content", item.content_id) ? item.content_id : null, subsectionId: boardId(item.subsection_id),
    url: `${prefix}/asset/${item.id}`, downloadUrl: `${prefix}/asset/${item.id}?download=1`,
    posterUrl: item.poster_object_key ? `${prefix}/asset/${item.id}?poster=1` : "" }));
  const root = share.records.get(key(share.kind, share.target_id));
  return { kind: share.kind, targetId: share.target_id, title: root.title || root.caption || root.filename || root.display_name || root.name,
    description: root.description || "", content, media, assets,
    subsections: selected("subsection").map(target => {
      const item = share.records.get(key("subsection", target.id));
      return { id: item.id, name: item.name, parentId: boardId(item.parent_id) };
    }) };
}
