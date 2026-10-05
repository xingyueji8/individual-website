import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { presentationSettings, sanitizeTextStyle } from "../src/personal-space.mjs";

assert.deepEqual(presentationSettings({}, {}, true), { article_layout: "inherit", gallery_layout: "inherit" });
assert.throws(() => presentationSettings({ articleLayout: "unknown" }));
assert.equal(sanitizeTextStyle("color:#ab1234;font-size:24px;font-family:KaiTi;text-decoration:underline;position:fixed;background:url(https://bad.test);width:100vw"), "color:#ab1234;font-size:24px;font-family:KaiTi;text-decoration:underline");
assert.equal(sanitizeTextStyle("color:var(--ink);font-size:1000px;font-family:expression(alert(1));background-color:url(x)"), "");

const mf = new Miniflare({ modules: true, cf: false, scriptPath: "src/worker.js", compatibilityDate: "2026-08-06", d1Databases: ["DB"], r2Buckets: ["BUCKET"],
  bindings: { ADMIN_PASSWORD: "personal-space-test-admin", SESSION_SECRET: "personal-space-test-secret-32-bytes" } });
let admin = "";
const cookie = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + "=")).split(";")[0];
async function request(path, { method = "GET", body, identity = admin } = {}) {
  return mf.dispatchFetch("https://localhost" + path, { method, headers: { Cookie: identity, "User-Agent": "personal-space-test", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function ok(path, options) {
  const response = await request(path, options); const data = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`); return data;
}
try {
  await ok("/api/guest/config", { identity: "" });
  admin = cookie(await request("/api/admin/login", { method: "POST", identity: "", body: { password: "personal-space-test-admin" } }), "xyj_admin");
  const guest = cookie(await request("/api/guest/enter", { method: "POST", identity: "", body: { visitorId: "personal-space-guest" } }), "xyj_guest");
  const sectionInput = { name: "记录生活", kind: "content", visibility: "public", showAll: true, description: "右侧说明\n第二行", articleLayout: "feed", galleryLayout: "grid" };
  const section = await ok("/api/admin/sections", { method: "POST", body: sectionInput });
  const sub = await ok("/api/admin/subsections", { method: "POST", body: { sectionId: section.id, name: "旅行", visibility: "public" } });
  const child = await ok("/api/admin/subsections", { method: "POST", body: { sectionId: section.id, parentId: sub.id, name: "秋天", visibility: "public", articleLayout: "article" } });
  const bootstrap = await ok("/api/bootstrap", { identity: guest });
  assert.equal(bootstrap.sections.find(item => item.id === section.id).article_layout, "feed");
  assert.equal(bootstrap.sections.find(item => item.id === section.id).description, sectionInput.description);
  assert.equal(bootstrap.subsections.find(item => item.id === sub.id).article_layout, "inherit");
  assert.equal(bootstrap.subsections.find(item => item.id === child.id).article_layout, "article");
  await ok(`/api/admin/sections/${section.id}`, { method: "PUT", body: { name: "新的说明", kind: "content", visibility: "public" } });
  assert.equal((await ok("/api/admin/sections")).find(item => item.id === section.id).article_layout, "feed", "older editors must preserve a saved layout");
  assert.equal((await request(`/api/admin/sections/${section.id}`, { method: "PUT", body: { ...sectionInput, articleLayout: "unsafe" } })).status, 400);
  for (const galleryLayout of ["grid", "masonry", "rows"]) {
    const gallery = await ok("/api/admin/sections", { method: "POST", body: { name: galleryLayout, kind: "gallery", visibility: "public", galleryLayout } });
    assert.equal((await ok("/api/bootstrap", { identity: guest })).sections.find(item => item.id === gallery.id).gallery_layout, galleryLayout);
  }
  const html = '<p>普通文字<span style="color:#c02642;font-size:24px;font-family:KaiTi;font-weight:700;text-decoration:underline;position:fixed" onclick="alert(1)">局部格式</span>普通结尾</p><script>alert(1)</script>';
  const article = await ok("/api/admin/content", { method: "POST", body: { sectionId: section.id, subsectionId: child.id, title: "富文本保存", status: "published", visibility: "public", bodyHtml: html } });
  const saved = await ok(`/api/admin/content/${article.id}`);
  const shown = await ok(`/api/content/${article.id}`, { identity: guest });
  const preview = await ok("/api/admin/content-preview", { method: "POST", body: { bodyHtml: html } });
  for (const body of [saved.body_html, shown.body_html, preview.body_html]) {
    assert.match(body, /color:#c02642;font-size:24px;font-family:KaiTi;font-weight:700;text-decoration:underline/);
    assert.match(body, /普通文字<span.*局部格式<\/span>普通结尾/);
    assert.doesNotMatch(body, /script|onclick|position/);
  }
  assert.equal((await request("/api/admin/content-preview", { identity: guest, method: "POST", body: { bodyHtml: html } })).status, 401);
  const attachmentPreview = await ok("/api/admin/content-preview", { method: "POST", body: { bodyHtml: '<div class="resource-embed is-selected" data-resource-type="asset" data-resource-id="fixture-attachment">附件</div>' } });
  assert.match(attachmentPreview.body_html, /class="resource-embed"/);
  assert.doesNotMatch(attachmentPreview.body_html, /is-selected/);
  await ok(`/api/admin/security/content/${article.id}`, { method: "PUT", body: { lock: { enabled: true, code: "765432" } } });
  assert.equal((await request(`/api/content/${article.id}`, { identity: guest })).status, 423, "inline feeds must not bypass article locks");
  assert.equal((await ok("/api/bootstrap", { identity: guest })).content.find(item => item.id === article.id).locked, true);
  const hidden = await ok("/api/admin/sections", { method: "POST", body: { name: "隐私板块", kind: "content", visibility: "private", articleLayout: "feed" } });
  assert.ok(!(await ok("/api/bootstrap", { identity: guest })).sections.some(item => item.id === hidden.id));
  console.log("personal space layouts, inheritance, safe rich-text round-trip, previews and locked feeds passed");
} finally { await mf.dispose(); }
