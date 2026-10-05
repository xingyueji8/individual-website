import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { parseHTML } from "linkedom";

// DOM interaction checks, not a substitute for visual/device browser testing.
function domContext(html) {
  const window = parseHTML(html);
  const { document, HTMLElement, HTMLSelectElement, HTMLInputElement } = window;
  Object.defineProperty(HTMLSelectElement.prototype, "value", {
    configurable: true,
    get() { return (this.querySelector("option[selected]") || this.options[0])?.value || ""; },
    set(value) { [...this.options].forEach(option => option.toggleAttribute("selected", option.value === String(value))); },
  });
  HTMLSelectElement.prototype.add = function (option) { this.append(option); };
  Object.defineProperty(HTMLInputElement.prototype, "checked", {
    configurable: true, get() { return this.hasAttribute("checked"); },
    set(value) { this.toggleAttribute("checked", Boolean(value)); },
  });
  HTMLElement.prototype.reset = function () {
    this.querySelectorAll("input,textarea").forEach(input => { input.value = input.getAttribute("value") || ""; });
    this.querySelectorAll("select").forEach(select => { select.value = select.options[0]?.value || ""; });
  };
  HTMLElement.prototype.showModal = function () { this.open = true; };
  HTMLElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.setInterval = () => 0;
  const alerts = [];
  const context = vm.createContext({
    window, document, Element: window.Element, Node: window.Node, Event: window.Event,
    console, URL, crypto: webcrypto, Response, File, Blob, FormData, TextEncoder,
    setTimeout, clearTimeout, performance, location: { href: "https://example.test/", origin: "https://example.test" },
    navigator: { onLine: true }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Option: function (text, value) { const node = document.createElement("option"); node.textContent = text; node.value = value; return node; },
    alert: message => alerts.push(message), confirm: () => true, prompt: () => null,
    fetch: async path => { throw new Error(`Unexpected network request: ${path}`); },
  });
  return { context, document, window, alerts, run: code => vm.runInContext(code, context) };
}

const sections = [
  { id: "articles", kind: "content", name: "Articles", show_all: 1 },
  { id: "photos", kind: "gallery", name: "Photos", show_all: 1 },
  { id: "files", kind: "resources", name: "Files", show_all: 1 },
];
const subsections = [
  { id: "photo-parent", section_id: "photos", name: "Parent" },
  { id: "photo-child", parent_id: "photo-parent", section_id: "photos", name: "Child" },
  { id: "file-parent", section_id: "files", name: "Docs" },
];

const studioHtml = await readFile("public/studio.html", "utf8");
const studio = domContext(studioHtml);
studio.run(await readFile("public/studio-organize.js", "utf8"));
studio.run(await readFile("public/studio-share.js", "utf8"));
studio.run(await readFile("public/studio-background.js", "utf8"));
studio.run(await readFile("public/studio-rich-text.js", "utf8"));
const main = [...studioHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes("const app ="));
assert.ok(main);
studio.run(main.replace("checkSession();", ""));
studio.run(`app.sections=${JSON.stringify(sections)};app.subsections=${JSON.stringify(subsections)};
  app.media=[{id:'photo-a',kind:'photo',filename:'a.png',caption:'Photo A',note:'A note',section_id:'photos',subsection_id:'photo-child',previewUrl:'/media/photo-a?preview=1',visibility:'public'}];
  app.users=[{id:'alice',username:'alice',nickname:'Alice',status:'approved'}];
  app.assetFolders=[{id:'custom-folder',section_id:'files',name:'Custom folder'}];
  refreshSectionOptions();renderMedia();`);

// Article panels hide without resetting forms, losing rich text or bypassing dirty-form protection.
studio.document.querySelector('[data-studio-category="content"]').click();
const articleNode = id => studio.document.getElementById(id);
const settingsPanel = articleNode("content-settings-panel");
const editorPanel = articleNode("content-editor-panel");
const panelLayout = articleNode("content-manager-layout");
const settingsOpen = articleNode("content-settings-open");
const editorOpen = articleNode("content-editor-open");
const settingsForm = articleNode("section-form");
const articleForm = articleNode("content-form");
const richText = articleNode("content-editor");
const closeSettings = studio.document.querySelector('[data-content-panel-close="settings"]');
const closeEditor = studio.document.querySelector('[data-content-panel-close="editor"]');
assert.equal(articleNode("content-panel-controls").hidden, false);
assert.equal(settingsPanel.hidden, false);
assert.equal(editorPanel.hidden, false);
assert.equal(settingsOpen.getAttribute("aria-controls"), settingsPanel.id);
assert.equal(editorOpen.getAttribute("aria-controls"), editorPanel.id);
for (const control of [settingsOpen, editorOpen, closeSettings, closeEditor]) assert.equal(control.type, "button");
assert.ok(settingsPanel.contains(closeSettings));
assert.ok(editorPanel.contains(closeEditor));
assert.ok(studio.document.querySelector(".content-manager-title-row").contains(settingsOpen));
articleNode("section-name").value = "未保存的板块名称";
articleNode("section-name").dispatchEvent(new studio.window.Event("input", { bubbles: true }));
articleNode("content-title").value = "尚未保存的文章标题";
richText.innerHTML = '<p>草稿正文 <strong>保留格式</strong></p>';
richText.dispatchEvent(new studio.window.Event("input", { bubbles: true }));
const draftHtml = richText.innerHTML;
let panelPrompts = 0;
studio.context.confirm = () => { panelPrompts += 1; return false; };
closeSettings.click();
assert.equal(settingsPanel.hidden, true);
assert.equal(editorPanel.hidden, false);
assert.equal(settingsOpen.getAttribute("aria-expanded"), "false");
assert.equal(panelLayout.classList.contains("has-one-panel"), true);
closeEditor.click();
assert.equal(editorPanel.hidden, true);
assert.equal(editorOpen.getAttribute("aria-expanded"), "false");
assert.equal(articleNode("content-panels-empty").hidden, false);
assert.equal(panelLayout.classList.contains("has-one-panel"), false);
assert.equal(articleNode("content-panel-controls").hidden, false, "restore controls stay visible when both panels close");
assert.equal(panelPrompts, 0, "hiding panels never prompts to discard a draft");
assert.equal(studio.run("activeStudioDirtyForms().length"), 2);
assert.equal(studio.run('switchView("site-content")'), false, "hidden drafts still guard navigation");
assert.equal(panelPrompts, 1);
assert.equal(studio.run("app.currentView"), "sections");
editorOpen.click();
assert.equal(editorPanel.hidden, false);
assert.equal(panelLayout.classList.contains("has-one-panel"), true);
assert.equal(articleNode("content-panels-empty").hidden, true);
settingsOpen.click();
settingsOpen.click(); // Reopening a visible panel is idempotent, not a draft-clearing toggle.
assert.equal(settingsPanel.hidden, false);
assert.equal(settingsOpen.getAttribute("aria-expanded"), "true");
assert.equal(editorOpen.getAttribute("aria-expanded"), "true");
assert.equal(panelLayout.classList.contains("has-one-panel"), false);
assert.equal(articleNode("section-form"), settingsForm);
assert.equal(articleNode("content-form"), articleForm);
assert.equal(articleNode("content-editor"), richText);
assert.equal(articleNode("section-name").value, "未保存的板块名称");
assert.equal(articleNode("content-title").value, "尚未保存的文章标题");
assert.equal(richText.innerHTML, draftHtml);
assert.equal(studio.run("activeStudioDirtyForms().length"), 2);
studio.run('setSectionEditorLevel("subsection")');
assert.equal(settingsOpen.textContent, "小板块设置");
closeSettings.click();
settingsOpen.click();
assert.equal(studio.document.querySelector('[data-section-editor-level="subsection"]').classList.contains("active"), true);
studio.run('setSectionEditorLevel("section")');
assert.equal(settingsOpen.textContent, "大板块设置");

// These article-only visibility choices must not hide the image or file management workspaces.
closeSettings.click();
closeEditor.click();
studio.context.confirm = () => true;
studio.run("discardCurrentStudioDraft()"); // Explicitly discard the test draft before switching categories.
studio.run('enterSectionManager("gallery")');
assert.equal(settingsPanel.hidden, false);
assert.equal(editorPanel.hidden, false);
assert.equal(articleNode("content-panel-controls").hidden, true);
assert.equal(closeSettings.hidden, true);
assert.equal(closeEditor.hidden, true);
studio.run('enterSectionManager("resources")');
assert.equal(settingsPanel.hidden, false);
assert.equal(editorPanel.hidden, false);
studio.run('enterSectionManager("content")');
assert.equal(settingsPanel.hidden, true, "article visibility survives category switches");
assert.equal(editorPanel.hidden, true);
settingsOpen.click();
editorOpen.click();
assert.equal(studio.run("activeStudioDirtyForms().length"), 0);

assert.equal(studio.document.querySelectorAll("#media-grid .media-card").length, 1);
assert.match(studio.document.querySelector("#media-grid").textContent, /A note/);
assert.match(studio.document.querySelector("#media-grid").textContent, /备注/);
assert.match(studio.document.querySelector("#media-grid").textContent, /下载权限 \/ 内容锁/);
studio.document.getElementById("photo-select-all").click();
assert.equal(studio.document.getElementById("photo-batch-count").textContent, "已选择 1 张");
assert.equal(studio.document.getElementById("photo-batch-move").disabled, false);
studio.document.getElementById("photo-clear-selection").click();
assert.equal(studio.document.getElementById("photo-batch-count").textContent, "已选择 0 张");
assert.match(studio.document.getElementById("photo-batch-target").textContent, /Parent \/ Child/);
studio.document.querySelector('[data-studio-category="gallery"]').click();
assert.equal(studio.document.getElementById("section-kind").value, "gallery");
assert.deepEqual([...studio.document.getElementById("subsection-section").options].map(item => item.value), ["photos"]);
assert.ok(studio.document.getElementById("studio-primary-nav").classList.contains("hidden"));
assert.ok(!studio.document.getElementById("studio-content-navigation").classList.contains("hidden"));
assert.equal(studio.document.getElementById("view-media").parentElement.id, "content-inline-editor-host");
assert.ok(studio.document.getElementById("view-media").classList.contains("active"));
assert.equal(studio.document.getElementById("media-section").value, "photos");
const childHierarchy = [...studio.document.querySelectorAll("#content-structure-nav button")]
  .find(button => button.textContent === "Child");
assert.ok(childHierarchy);
childHierarchy.click();
assert.equal(studio.document.getElementById("subsection-id").value, "photo-child");
assert.equal(studio.document.getElementById("media-subsection").value, "photo-child");
assert.match(studio.document.getElementById("content-inline-scope").textContent, /Photos \/ Child/);
studio.document.getElementById("subsection-parent").value = "photo-parent";
assert.equal(studio.document.getElementById("subsection-parent").value, "photo-parent");
assert.ok(studio.document.getElementById("content-section-assets-panel").hasAttribute("hidden"));
assert.ok(studio.document.getElementById("asset-upload-photo").hasAttribute("hidden"));
studio.run('fillAssetSections();document.getElementById("asset-section").value="files";renderAssetBrowser();');
assert.match(studio.document.getElementById("asset-browser").textContent, /Custom folder/);

// Saving the photo permission is a partial update with durable same-card feedback.
const writes = [];
studio.context.fetch = async (path, init) => {
  writes.push({ path, body: init?.body && JSON.parse(init.body) });
  return Response.json({ id: "photo-a", visibility: "public", allowed_user_ids: [] });
};
await studio.run(`(async()=>{
  const card=document.querySelector('#media-grid .media-card');
  const save=[...card.querySelectorAll('button')].find(button=>button.textContent==='保存照片权限');
  await updateMediaVisibility(app.media[0],card.querySelector('select[aria-label$="的可见范围"]'),card.querySelector('.audience-picker'),save);
})()`);
assert.deepEqual(writes[0].body, { visibility: "public", allowedUserIds: [] });
assert.match(studio.document.querySelector(".media-save-status").textContent, /已保存/);

// Common security editor: invalid PINs must not submit or half-save downloads.
studio.context.fetch = async (path, init) => {
  if (!init?.method) return Response.json({ downloads: [], locks: [] });
  writes.push({ path, body: JSON.parse(init.body) }); return Response.json({ ok: true });
};
await studio.run('app.media[0].hasMosaic=true;editContentSecurity("media",app.media[0])');
const securityDialog = studio.document.querySelector("dialog.organize-dialog");
securityDialog.querySelector('.checkbox-field input').checked = true;
const code = securityDialog.querySelector('input[type="password"]');
const form = securityDialog.querySelector("form");
code.value = "123";
const before = writes.length;
form.dispatchEvent(new studio.window.Event("submit", { bubbles: true, cancelable: true }));
assert.equal(writes.length, before);
assert.match(securityDialog.querySelector('[role="status"]').textContent, /六位/);
code.value = "012345";
form.dispatchEvent(new studio.window.Event("submit", { bubbles: true, cancelable: true }));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(writes.at(-1).body.lock.code, "012345");
assert.equal(code.value, "");
assert.match(securityDialog.querySelector('[role="status"]').textContent, /已保存/);
securityDialog.close();
assert.deepEqual(studio.alerts, []);

const portfolio = domContext(await readFile("public/index.html", "utf8"));
portfolio.context.state = { data: {
  sections, subsections, content: [], media: [{ id: "photo-a", section_id: "photos", subsection_id: "photo-child", caption: "Photo A", note: "A note", previewUrl: "/media/photo-a?mosaic=1", locked: true }],
  assets: [{ id: "asset-a", section_id: "files", folder_id: null, status: "ready", kind: "video" }],
  assetFolders: [{ id: "custom-folder", section_id: "files", name: "Custom folder" }],
}, activeSubsections: {}, imageSequence: [] };
portfolio.context.portfolioSections = () => portfolio.context.state.data.sections;
portfolio.context.empty = text => { const node = portfolio.document.createElement("p"); node.textContent = text; return node; };
portfolio.context.resourceFolderPath = () => "Files";
portfolio.context.resourceCardForFolder = item => portfolio.context.empty(item.name);
portfolio.context.resourceCardForAsset = item => portfolio.context.empty(item.id);
portfolio.context.contentCard = item => portfolio.context.empty(item.title);
portfolio.context.api = async () => portfolio.context.state.data;
portfolio.context.fetch = async () => Response.json({ ok: true });
portfolio.run(await readFile("public/portfolio-organize.js", "utf8"));
portfolio.run(await readFile("public/personal-space.js", "utf8"));
portfolio.run('function renderPortfolio(){renderOrganizedPortfolio()} function renderPortfolioPanel(){renderOrganizedPanel()}');
portfolio.run('renderPortfolio();');
assert.deepEqual([...portfolio.document.querySelectorAll(".ps-landing .ps-entry strong")].map(node => node.textContent), ["文章", "图片", "文件/视频"]);
portfolio.run('personalSpaceRoute={category:"gallery",sectionId:"photos",subsectionId:"photo-child",all:false};renderPortfolio();');
assert.match(portfolio.document.querySelector(".photo-name").textContent, /A note.*已锁定/);
assert.match(portfolio.document.querySelector(".photo-card img").getAttribute("src"), /mosaic=1/);
portfolio.run('personalSpaceRoute.subsectionId="photo-parent";renderPortfolioPanel();');
assert.equal(portfolio.document.querySelectorAll(".photo-card").length, 0);
assert.match(portfolio.document.querySelector(".ps-page").textContent, /Child/);

// Navigating deeper keeps the redeemed parent lock, while leaving a sibling revokes it.
portfolio.run(`contentViewGrants.set('section:photos',{kind:'section',id:'photos',owner:'section:photos',token:'${"a".repeat(64)}',expiresAt:Date.now()+10000});
  contentViewGrants.set('subsection:photo-parent',{kind:'subsection',id:'photo-parent',owner:'subsection:photo-parent',token:'${"b".repeat(64)}',expiresAt:Date.now()+10000});`);
await portfolio.run(`(async()=>{const keep=subsectionGrantPath('photos','photo-child');await releaseViewGrants(grant=>!keep.has(grant.kind+':'+grant.id))})()`);
assert.equal(portfolio.run("contentViewGrants.size"), 2);
await portfolio.run(`(async()=>{const keep=subsectionGrantPath('photos','all');await releaseViewGrants(grant=>!keep.has(grant.kind+':'+grant.id))})()`);
assert.equal(portfolio.run("contentViewGrants.size"), 1);
portfolio.run('personalSpaceRoute={category:"resources",sectionId:"files",subsectionId:"",all:true};renderPortfolio();');
assert.match(portfolio.document.getElementById("resource-grid").textContent, /Custom folder/);
assert.match(portfolio.document.getElementById("resource-grid").textContent, /asset-a/);
assert.deepEqual(portfolio.alerts, []);

// Multi-page routes round-trip, never expose children as tabs alongside their
// parent content, and keep browser-history navigation separate from data reads.
portfolio.context.AbortController = AbortController;
portfolio.document.getElementById("personal-space-title").focus = () => {};
portfolio.context.history = { state: null, pushState(value, _, url) { this.state = value; portfolio.context.location.hash = new URL(url, "https://example.test").hash; },
  replaceState(value, _, url) { this.state = value; portfolio.context.location.hash = new URL(url, "https://example.test").hash; } };
const indexSource = await readFile("public/index.html", "utf8");
const historyFunction = indexSource.slice(indexSource.indexOf('    function updateSectionHistory('), indexSource.indexOf('    /* 同一游客'));
portfolio.run('const APP_HISTORY_LAYER="app";'); portfolio.run(historyFunction);
portfolio.run('contentViewGrants.clear();personalSpaceNavigate({category:"gallery",sectionId:"photos",subsectionId:"photo-parent",all:true});');
assert.equal(portfolio.context.location.hash, "#portfolio/gallery/photos/photo-parent/~all");
assert.equal(portfolio.document.querySelectorAll(".photo-card").length, 1);
assert.equal(portfolio.run('personalSpaceRouteFromHash(location.hash).subsectionId'), "photo-parent");
assert.equal(portfolio.run('personalSpaceRouteFromHash(location.hash).all'), true);
portfolio.context.location.hash = "#portfolio/gallery/photos/photo-parent";
portfolio.run('personalSpaceRestoreLocation();');
assert.equal(portfolio.document.querySelectorAll(".photo-card").length, 0);
assert.ok(portfolio.document.querySelector(".ps-entry-small"));
assert.equal(portfolio.run('personalSpaceLayout({id:"photos",gallery_layout:"grid"},{id:"child",parent_id:"photo-parent",gallery_layout:"inherit"},"gallery_layout","grid")'), "grid");
portfolio.run('state.data.subsections.find(item=>item.id==="photo-parent").gallery_layout="masonry";renderPortfolio();');
assert.equal(portfolio.run('personalSpaceLayout({id:"photos",gallery_layout:"grid"},{id:"child",parent_id:"photo-parent",gallery_layout:"inherit"},"gallery_layout","grid")'), "masonry");
portfolio.run('personalSpaceNavigate({});');
// The page change follows the shared button rebound midpoint, including when
// the theme changes that duration; it must not retain the old 120 ms delay.
portfolio.context.getComputedStyle = () => ({ getPropertyValue: () => "940ms" });
portfolio.document.querySelector(".ps-landing .ps-entry").click();
assert.equal(portfolio.document.querySelectorAll(".ps-landing .ps-entry").length, 3, "a press begins before the page changes");
await new Promise(resolve => setTimeout(resolve, 145));
assert.equal(portfolio.document.querySelectorAll(".ps-landing .ps-entry").length, 3, "the slower button feedback is still running");
await new Promise(resolve => setTimeout(resolve, 350));
assert.equal(portfolio.context.location.hash, "#portfolio/content");
assert.equal(portfolio.document.querySelectorAll(".ps-section-row").length, 1);

// Feed uses the actual shared reader renderer, orders publications rather than
// edits, loads full bodies, and never requests a locked body's bytes.
const requestedBodies = [];
portfolio.context.api = async path => {
  if (path.startsWith("/api/content/")) { requestedBodies.push(path); return { id: path.split("/").at(-1), body_html: '<p>正文<span style="color:#aa2244;font-size:24px">部分格式</span></p>', inlineMedia: [] }; }
  return portfolio.context.state.data;
};
portfolio.context.mediaIdFromUrl = () => null;
portfolio.context.enhanceArticleLinks = () => {};
portfolio.run(indexSource.slice(indexSource.indexOf('    function renderReaderBody('), indexSource.indexOf('    const IMAGE_ZOOM_MIN')));
portfolio.run(`state.data.sections.find(item=>item.id==="articles").article_layout="feed";
  state.data.content=[
    {id:"older",section_id:"articles",title:"旧动态",published_at:"2026-09-01T00:00:00Z",updated_at:"2026-10-05T00:00:00Z"},
    {id:"newer",section_id:"articles",title:"新动态",published_at:"2026-10-04T00:00:00Z"},
    {id:"secret",section_id:"articles",title:"已锁定动态",published_at:"2026-09-03T00:00:00Z",locked:true}];
  personalSpaceNavigate({category:"content",sectionId:"articles"});`);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual([...portfolio.document.querySelectorAll(".ps-feed-entry")].map(node => node.dataset.contentId), ["newer", "secret", "older"]);
assert.deepEqual(requestedBodies.sort(), ["/api/content/newer", "/api/content/older"]);
assert.match(portfolio.document.querySelector(".ps-feed-date").textContent, /2026年10月4日.*星期日/);
assert.match(portfolio.document.querySelector(".ps-feed-body").innerHTML, /font-size:24px/);
assert.ok(portfolio.document.querySelector('[data-content-id="secret"] .locked-content-notice'));
portfolio.run('personalSpaceNavigate({category:"resources",sectionId:"files",all:true});state.currentResourceFolder="custom-folder";contentViewGrants.set("assetFolder:custom-folder",{kind:"assetFolder",id:"custom-folder",token:"folder-token",expiresAt:Date.now()+10000});personalSpaceNavigate(personalSpaceRoute,{preserveFolder:true});');
assert.equal(portfolio.run('contentViewGrants.has("assetFolder:custom-folder")'), true, "opening a protected folder keeps its redeemed lock");
portfolio.run('contentViewGrants.clear();');

// Studio keeps independent overrides and hides controls for unrelated kinds.
studio.run('editSection({...app.sections[0],article_layout:"feed",gallery_layout:"grid"});');
assert.equal(studio.run('sectionPayload().articleLayout'), "feed");
assert.equal(studio.document.querySelector('[data-presentation-prefix="section"][data-presentation-kind="gallery"]').hidden, true);
studio.run('editSubsection({...app.subsections[0],gallery_layout:"rows"});');
assert.equal(studio.run('studioPresentationPayload("subsection").galleryLayout'), "rows");
assert.equal(studio.document.querySelector('[data-presentation-prefix="subsection"][data-presentation-kind="content"]').hidden, true);
console.log("photo queue controls, permission feedback, lock editor and three-category DOM regression passed");
