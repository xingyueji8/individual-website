import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";

const mf = new Miniflare({ modules: true, cf: false, scriptPath: "src/worker.js", compatibilityDate: "2026-08-06",
  d1Databases: ["DB"], r2Buckets: ["BUCKET"], assets: { directory: "public", binding: "ASSETS", routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true }, assetConfig: { html_handling: "auto-trailing-slash" } },
  bindings: { ADMIN_PASSWORD: "shares-admin", SESSION_SECRET: "shares-secret-at-least-32-characters" } });
const origin = "https://localhost";
let admin;
async function request(path, { cookie = admin, method = "GET", body, headers = {} } = {}) {
  const init = { method, headers: { "User-Agent": "shares-test", ...(cookie ? { Cookie: cookie } : {}), ...headers } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  return mf.dispatchFetch(origin + path, init);
}
async function ok(path, options) {
  const response = await request(path, options), body = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`); return body;
}
async function status(expected, path, options) {
  const response = await request(path, options); assert.equal(response.status, expected, `${path}: ${await response.text()}`);
}
const cookie = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + "="))?.split(";")[0];
const hash = value => createHash("sha256").update(value).digest("hex");
async function prepare(kind, id) { return ok("/api/admin/shares", { method: "POST", body: { kind, id } }); }
async function activate(share) { return ok(`/api/admin/shares/${share.token}/activate`, { method: "POST", body: {} }); }
async function share(kind, id) { const link = await prepare(kind, id); await activate(link); return link; }
const articlePayload = (title, subsectionId = null, visibility = "private", status = "published", bodyHtml = "<p>SHARED-BODY</p>") => ({ sectionId: "section-essays", subsectionId, title, visibility, status, bodyHtml });

try {
  await ok("/api/guest/config", { cookie: "" });
  const login = await request("/api/admin/login", { cookie: "", method: "POST", body: { password: "shares-admin" } });
  assert.equal(login.status, 200); admin = cookie(login, "xyj_admin");
  const db = await mf.getD1Database("DB"), bucket = await mf.getR2Bucket("BUCKET");
  const timestamp = new Date().toISOString();
  async function photo(id, { subsectionId = null, contentId = null, kind = "photo", sectionId = "section-photos" } = {}) {
    await db.prepare(`INSERT INTO media(id,filename,object_key,preview_object_key,mime_type,size_bytes,kind,visibility,section_id,subsection_id,content_id,created_at,updated_at)
      VALUES(?,?,?,?,'image/png',8,?,'private',?,?,?,?,?)`).bind(id, `${id}.png`, `${id}-original`, `${id}-preview`, kind, sectionId, subsectionId, contentId, timestamp, timestamp).run();
    await bucket.put(`${id}-original`, "ORIGINAL-" + id, { httpMetadata: { contentType: "image/png" } });
    await bucket.put(`${id}-preview`, "PREVIEW-" + id, { httpMetadata: { contentType: "image/webp" } });
  }
  async function asset(id, contentId = null, kind = "video", mime = "video/mp4") {
    await db.prepare(`INSERT INTO assets(id,filename,display_name,object_key,mime_type,size_bytes,kind,status,visibility,access_mode,download_policy,scope,content_id,section_id,created_at,updated_at)
      VALUES(?,?,?,?,?,10,?,'ready','private','private','member',?,?, 'section-essays',?,?)`)
      .bind(id, `${id}.mp4`, id, `${id}-bytes`, mime, kind, contentId ? "article" : "section", contentId, timestamp, timestamp).run();
    await bucket.put(`${id}-bytes`, "0123456789", { httpMetadata: { contentType: mime } });
  }

  const outsideArticle = await ok("/api/admin/content", { method: "POST", body: articlePayload("OTHER-PRIVATE-ARTICLE") });
  const draft = await ok("/api/admin/content", { method: "POST", body: articlePayload("SECRET-DRAFT", null, "private", "draft") });
  await photo("outside-photo");
  await asset("outside-asset");
  const article = await ok("/api/admin/content", { method: "POST", body: articlePayload("Share article") });
  await photo("article-image", { kind: "inline", contentId: article.id, sectionId: "section-essays" });
  await asset("article-video", article.id);
  await ok(`/api/admin/content/${article.id}`, { method: "PUT", body: articlePayload("Share article", null, "private", "published",
    '<p>SHARED-BODY</p><img src="/media/article-image"><img src="/media/outside-photo"><div class="resource-embed" data-resource-type="asset" data-resource-id="article-video"></div><div class="resource-embed" data-resource-type="folder" data-resource-id="outside-folder"></div>') });
  await ok(`/api/admin/security/content/${article.id}`, { method: "PUT", body: { download: { mode: "none" }, lock: { enabled: true, code: "001234" } } });
  // A private ancestor does not need to become public for an isolated article share.
  await db.prepare("UPDATE portfolio_sections SET visibility='private',download_policy='member' WHERE id='section-essays'").run();
  await status(401, "/api/admin/shares", { cookie: "", method: "POST", body: { kind: "content", id: article.id } });
  await status(409, "/api/admin/shares", { method: "POST", body: { kind: "content", id: draft.id } });
  await status(400, "/api/admin/shares", { method: "POST", body: { kind: "section", id: "section-essays" } });
  const pending = await prepare("content", article.id);
  assert.match(pending.url, /^https:\/\/localhost\/share\/[a-f0-9]{64}$/);
  assert.equal((await db.prepare("SELECT visibility FROM content WHERE id=?").bind(article.id).first()).visibility, "private");
  assert.equal((await db.prepare("SELECT enabled FROM content_locks WHERE target_id=?").bind(article.id).first()).enabled, 1);
  await status(410, `/api/shares/${pending.token}`, { cookie: "" });
  await activate(pending);
  await activate(pending); // Retry after an ambiguous network response is harmless.
  const prefix = `/api/shares/${pending.token}`;
  const listing = await ok(prefix, { cookie: "" });
  assert.deepEqual(listing.content.map(item => item.id), [article.id]);
  assert.deepEqual(listing.media.map(item => item.id), ["article-image"]);
  assert.deepEqual(listing.assets.map(item => item.id), ["article-video"]);
  assert.equal((await db.prepare("SELECT visibility FROM portfolio_sections WHERE id='section-essays'").first()).visibility, "private");
  assert.equal((await db.prepare("SELECT visibility FROM content WHERE id=?").bind(outsideArticle.id).first()).visibility, "private");
  const read = await ok(`${prefix}/content/${article.id}`, { cookie: "" });
  assert.match(read.body_html, /SHARED-BODY/); assert.ok(read.body_html.includes(prefix + "/media/article-image?preview=1"));
  assert.ok(!read.body_html.includes("/media/outside-photo")); assert.ok(!read.body_html.includes("outside-folder"));
  assert.ok(!JSON.stringify(listing).match(/object_key|bytes|stream_uid|OTHER-PRIVATE|SECRET-DRAFT/));
  const preview = await request(`${prefix}/media/article-image?preview=1`, { cookie: "" });
  assert.equal(await preview.text(), "PREVIEW-article-image"); assert.equal(preview.headers.get("Cache-Control"), "private, no-store");
  const download = await request(`${prefix}/media/article-image?download=1`, { cookie: "" });
  assert.equal(await download.text(), "ORIGINAL-article-image"); assert.match(download.headers.get("Content-Disposition"), /^attachment/);
  const range = await request(`${prefix}/asset/article-video`, { cookie: "", headers: { Range: "bytes=2-5" } });
  assert.equal(range.status, 206); assert.equal(await range.text(), "2345"); assert.equal(range.headers.get("Cache-Control"), "private, no-store");
  const head = await request(`${prefix}/asset/article-video`, { cookie: "", method: "HEAD" }); assert.equal(head.status, 200); assert.equal(head.headers.get("Content-Length"), "10");
  for (const [kind, id] of [["content", outsideArticle.id], ["content", draft.id], ["media", "outside-photo"], ["asset", "outside-asset"]]) await status(404, `${prefix}/${kind}/${id}`, { cookie: "" });
  await status(404, `${prefix}/asset/outside-asset?variant=invalid`, { cookie: "" });
  await status(404, "/media/article-image?download=1", { cookie: "" }); // No ordinary ancestor bypass.
  await status(401, "/api/bootstrap", { cookie: "" }); // A share never issues full guest access.
  await status(405, prefix, { cookie: "", method: "POST", body: {} });
  await status(410, `/api/shares/${"0".repeat(64)}`, { cookie: "" });

  const page = await request(pending.url.replace(origin, ""), { cookie: "" });
  assert.equal(page.status, 200); assert.match(page.headers.get("Content-Type"), /text\/html/);
  assert.ok((await page.text()).includes("share-login-dialog"));
  const scopedCookie = cookie(page, "xyj_share"); assert.equal(scopedCookie, "xyj_share=1");
  const guest = await request("/api/guest/enter", { cookie: "", method: "POST", body: { visitorId: "share-guest-visitor-123456" } });
  assert.equal(guest.status, 200); const guestCookie = cookie(guest, "xyj_guest");
  for (const path of ["/api/bootstrap", "/api/guest/entry-background", "/media/outside-photo?preview=1", "/files/outside-asset"])
    await status(401, path, { cookie: `${scopedCookie}; ${guestCookie}` });
  await status(401, "/api/guest/enter", { cookie: scopedCookie, method: "POST", body: { visitorId: "share-guest-visitor-123456" } });
  await ok(prefix, { cookie: scopedCookie });

  // Withdrawal is permanent, including when public permission is restored later.
  await ok(`/api/admin/security/content/${article.id}`, { method: "PUT", body: { download: { mode: "member" } } });
  await status(410, prefix, { cookie: "" });
  await status(410, `${prefix}/media/article-image?download=1`, { cookie: "" });
  await ok(`/api/admin/security/content/${article.id}`, { method: "PUT", body: { download: { mode: "public" } } });
  await status(410, prefix, { cookie: "" });
  const renewed = await share("content", article.id);
  await ok(`/api/admin/content/${article.id}`, { method: "PUT", body: articlePayload("Share article", null, "private") });
  await status(410, `/api/shares/${renewed.token}`, { cookie: "" });

  // Whole subsection includes saved descendants, excludes drafts and future uploads.
  const board = await ok("/api/admin/subsections", { method: "POST", body: { sectionId: "section-photos", name: "Shared photos", visibility: "private", downloadPolicy: "member" } });
  const child = await ok("/api/admin/subsections", { method: "POST", body: { sectionId: "section-photos", parentId: board.id, name: "Child photos", visibility: "private" } });
  await photo("board-photo", { subsectionId: board.id }); await photo("child-photo", { subsectionId: child.id });
  const boardShare = await share("subsection", board.id), boardPrefix = `/api/shares/${boardShare.token}`;
  const boardListing = await ok(boardPrefix, { cookie: "" });
  assert.deepEqual(new Set(boardListing.media.map(item => item.id)), new Set(["board-photo", "child-photo"]));
  assert.equal(boardListing.subsections.length, 2);
  await photo("future-photo", { subsectionId: board.id });
  await status(404, `${boardPrefix}/media/future-photo?download=1`, { cookie: "" });
  assert.equal((await db.prepare("SELECT visibility FROM media WHERE id='future-photo'").first()).visibility, "private");
  await ok(`/api/admin/subsections/${board.id}`, { method: "PUT", body: { sectionId: "section-photos", name: "Shared photos", visibility: "public", downloadPolicy: "member" } });
  await status(410, boardPrefix, { cookie: "" });
  await status(401, "/media/board-photo?download=1", { cookie: guestCookie });
  const onlyPhoto = await share("media", "board-photo");
  await status(404, `/api/shares/${onlyPhoto.token}/media/child-photo`, { cookie: "" });
  await ok(`/api/admin/media/board-photo`, { method: "PUT", body: { visibility: "member" } });
  await status(410, `/api/shares/${onlyPhoto.token}`, { cookie: "" });

  // A content/permission edit between preparation and copying cannot be published accidentally.
  const stale = await prepare("media", "outside-photo");
  await ok("/api/admin/media/outside-photo", { method: "PUT", body: { caption: "Edited after prepare" } });
  await status(410, `/api/admin/shares/${stale.token}/activate`, { method: "POST", body: {} });
  assert.equal((await db.prepare("SELECT visibility FROM media WHERE id='outside-photo'").first()).visibility, "private");
  const expired = await prepare("media", "outside-photo");
  await db.prepare("UPDATE share_links SET prepare_expires_at=0 WHERE token_hash=?").bind(hash(expired.token)).run();
  await status(410, `/api/admin/shares/${expired.token}/activate`, { method: "POST", body: {} });
  const lockShare = await share("media", "outside-photo");
  await ok("/api/admin/security/media/outside-photo", { method: "PUT", body: { lock: { enabled: true, code: "123456" } } });
  await status(410, `/api/shares/${lockShare.token}`, { cookie: "" });
  const fileShare = await share("asset", "outside-asset");
  await ok(`/api/shares/${fileShare.token}`, { cookie: "" });
  await ok("/api/admin/assets/outside-asset", { method: "DELETE" });
  await status(410, `/api/shares/${fileShare.token}`, { cookie: "" });

  // Failure anywhere in activation must roll back the permission changes too.
  await photo("atomic-photo"); const atomic = await prepare("media", "atomic-photo");
  await db.prepare(`CREATE TRIGGER fail_share_activation BEFORE INSERT ON download_rules
    WHEN NEW.target_kind='media' AND NEW.target_id='atomic-photo' BEGIN SELECT RAISE(ABORT,'activation test failure'); END`).run();
  await status(500, `/api/admin/shares/${atomic.token}/activate`, { method: "POST", body: {} });
  assert.equal((await db.prepare("SELECT visibility FROM media WHERE id='atomic-photo'").first()).visibility, "private");
  assert.equal((await db.prepare("SELECT state FROM share_links WHERE token_hash=?").bind(hash(atomic.token)).first()).state, "pending");
  await db.prepare("DROP TRIGGER fail_share_activation").run(); await activate(atomic);
  await asset("unsafe-asset", null, "file", "text/html"); const unsafe = await share("asset", "unsafe-asset");
  const unsafeBytes = await request(`/api/shares/${unsafe.token}/asset/unsafe-asset`, { cookie: "" });
  assert.equal(unsafeBytes.headers.get("Content-Type"), "application/octet-stream");
  assert.match(unsafeBytes.headers.get("Content-Disposition"), /^attachment/);
  assert.match(unsafeBytes.headers.get("Content-Security-Policy"), /sandbox/);
  await status(400, "/api/admin/shares", { method: "POST", body: { kind: "content", id: [article.id] } });
  console.log("scoped sharing, activation, withdrawal, hierarchy, article resources, Range and visitor isolation passed");
} finally { await mf.dispose(); }
