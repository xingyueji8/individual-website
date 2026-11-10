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
  HTMLElement.prototype.focus = function () {};
  HTMLElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.setInterval = () => 0;
  const alerts = [];
  const context = vm.createContext({
    window, document, Element: window.Element, Node: window.Node, Event: window.Event,
    console, URL, crypto: webcrypto, Response, File, Blob, FormData, TextEncoder, AbortController,
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
studio.run(await readFile("public/studio-upload.js", "utf8"));
studio.run(await readFile("public/studio-organize.js", "utf8"));
studio.run(await readFile("public/studio-share.js", "utf8"));
studio.run(await readFile("public/studio-background.js", "utf8"));
studio.run(await readFile("public/studio-rich-text.js", "utf8"));
studio.run(await readFile("public/studio-content.js", "utf8"));
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
assert.equal(settingsPanel.hidden, true, "existing content is the default workspace");
assert.equal(editorPanel.hidden, false);
articleNode("new-content").click();
articleNode("content-panels-both").click();
assert.equal(settingsPanel.hidden, false);
assert.equal(settingsOpen.getAttribute("aria-controls"), settingsPanel.id);
assert.equal(editorOpen.getAttribute("aria-controls"), editorPanel.id);
for (const control of [settingsOpen, editorOpen, closeSettings, closeEditor]) assert.equal(control.type, "button");
assert.ok(settingsPanel.contains(closeSettings));
assert.ok(editorPanel.contains(closeEditor));
assert.ok(studio.document.querySelector(".content-selection-header").contains(settingsOpen));
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
assert.equal(editorOpen.getAttribute("aria-expanded"), "false");
articleNode("content-panels-both").click();
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
assert.equal(settingsOpen.textContent, "板块设置");
closeSettings.click();
settingsOpen.click();
assert.equal(studio.document.querySelector('[data-section-editor-level="subsection"]').classList.contains("active"), true);
studio.run('setSectionEditorLevel("section")');
assert.equal(settingsOpen.textContent, "板块设置");

// All categories follow the same browse-first workflow, independent of closed panels.
closeSettings.click();closeEditor.click();studio.context.confirm=()=>true;
studio.run("discardCurrentStudioDraft()");
for(const category of ["gallery","resources","content"]){
  studio.run(`enterSectionManager("${category}")`);
  assert.equal(settingsPanel.hidden,true);assert.equal(editorPanel.hidden,false);
  assert.equal(articleNode("content-panel-controls").hidden,false);
  assert.equal(closeSettings.hidden,false);assert.equal(closeEditor.hidden,false);
}
assert.equal(studio.run("activeStudioDirtyForms().length"),0);

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
assert.ok(!studio.document.getElementById("studio-primary-nav").classList.contains("hidden"));
assert.ok(!studio.document.getElementById("studio-content-navigation").classList.contains("hidden"));
assert.equal(studio.document.getElementById("view-media").parentElement.id, "content-inline-editor-host");
assert.ok(studio.document.getElementById("view-media").classList.contains("active"));
assert.equal(studio.document.getElementById("media-section").value, "photos");
const childHierarchy = [...studio.document.querySelectorAll("#content-structure-nav button")]
  .find(button => button.dataset.boardId === "photo-child");
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

// The shared creation controls work before a first small board exists, preserve
// the selected category/parent, and retain unsaved changes when navigation is denied.
studio.context.fetch = async path => { throw new Error(`Unexpected request while creating a board: ${path}`); };
studio.run('discardCurrentStudioDraft();enterSectionManager("content")');
assert.equal(articleNode("create-subsection").disabled, false);
assert.equal(articleNode("create-subsection-child").disabled, false);
articleNode("create-subsection-child").click();
assert.equal(articleNode("subsection-form-title").textContent, "新建小小板块");
assert.equal(articleNode("subsection-parent").required, true);
assert.equal(articleNode("subsection-parent").value, "");
assert.match(articleNode("subsection-form-description").textContent, /还没有小板块/);
assert.ok(articleNode("subsection-form").closest("[data-section-editor-level]").classList.contains("active"));
articleNode("subsection-form").dispatchEvent(new studio.window.Event("submit", { bubbles: true, cancelable: true }));
assert.match(articleNode("subsection-notice").textContent, /请选择.*上级小板块/);
closeSettings.click();
articleNode("create-subsection").click();
assert.equal(settingsPanel.hidden, false);
assert.equal(articleNode("subsection-form-title").textContent, "新建小板块");
assert.equal(articleNode("subsection-parent").required, false);
assert.equal(articleNode("subsection-save").textContent, "保存小板块");
assert.equal(studio.run("app.sectionEditorLevel"), "subsection");
assert.equal(articleNode("subsection-section").value, "articles");
assert.equal(articleNode("subsection-parent").value, "");
assert.equal(articleNode("subsection-id").value, "");
assert.equal(studio.run("app.subsections.filter(item=>item.section_id==='articles').length"), 0);
articleNode("subsection-name").value = "保留未保存的小板块";
articleNode("subsection-name").dispatchEvent(new studio.window.Event("input", { bubbles: true }));
studio.context.confirm = () => false;
studio.document.querySelector('[data-studio-create="section"]').click();
assert.equal(articleNode("subsection-name").value, "保留未保存的小板块");
assert.equal(articleNode("subsection-section").value, "articles");
assert.equal(studio.run("app.sectionEditorLevel"), "subsection");
studio.context.confirm = () => true;
studio.run('discardCurrentStudioDraft();resetSectionForm();setSectionEditorLevel("section")');
articleNode("create-subsection").click();
assert.equal(articleNode("subsection-section").value, "articles", "a blank large-board draft does not make creation silently fail");

// Complete the article creation flow through the real submit listeners and a
// fixture API. Opening a child form must not create a sibling by accident.
const boardWrites = [];
const savedBoards = JSON.parse(JSON.stringify(studio.run("app.subsections")));
studio.context.fetch = async (path, options = {}) => {
  assert.equal(path, "/api/admin/subsections");
  if (options.method === "POST") {
    const body = JSON.parse(options.body);
    const id = `article-board-${boardWrites.length + 1}`;
    boardWrites.push(body);
    savedBoards.push({ id, name: body.name, section_id: body.sectionId, parent_id: body.parentId });
    return Response.json({ id });
  }
  assert.equal(options.method, undefined);
  return Response.json(savedBoards);
};
const submitBoard = async name => {
  articleNode("subsection-name").value = name;
  articleNode("subsection-name").dispatchEvent(new studio.window.Event("input", { bubbles: true }));
  articleNode("subsection-form").dispatchEvent(new studio.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
};
await submitBoard("Article notes");
assert.equal(boardWrites.length, 1);
assert.equal(boardWrites[0].sectionId, "articles");
assert.equal(boardWrites[0].parentId, null);
assert.equal(articleNode("subsection-id").value, "article-board-1");
assert.equal(articleNode("subsection-form-title").textContent, "编辑小板块");
articleNode("create-subsection-child").click();
assert.equal(articleNode("subsection-parent").value, "article-board-1");
assert.equal(articleNode("subsection-save").textContent, "保存小小板块");
await submitBoard("Java");
assert.equal(boardWrites.length, 2);
assert.equal(boardWrites[1].sectionId, "articles");
assert.equal(boardWrites[1].parentId, "article-board-1");
assert.equal(articleNode("subsection-form-title").textContent, "编辑小小板块");
assert.equal(articleNode("subsection-parent").required, false, "editing a saved board is not stuck in creation mode");

// With only the large board selected, offer the parent selector rather than a
// disabled button, and keep child creation required after a category change.
studio.run('editSection(app.sections.find(item=>item.id==="articles"))');
articleNode("create-subsection-child").click();
assert.equal(articleNode("subsection-parent").value, "");
assert.match(articleNode("subsection-form-description").textContent, /请选择上级小板块/);
assert.equal(articleNode("subsection-parent").required, true);
await submitBoard("Needs a parent");
assert.equal(boardWrites.length, 2, "missing parent cannot submit a sibling instead");
studio.run('app.sections.push({id:"other-articles",kind:"content",name:"Other articles"});app.subsections.push({id:"other-parent",section_id:"other-articles",name:"Other parent"});refreshSectionOptions()');
articleNode("subsection-section").value = "other-articles";
articleNode("subsection-section").dispatchEvent(new studio.window.Event("change", { bubbles: true }));
assert.equal(articleNode("subsection-parent").value, "");
assert.equal(articleNode("subsection-parent").required, true);
articleNode("subsection-parent").value = "other-parent";
articleNode("subsection-parent").dispatchEvent(new studio.window.Event("change", { bubbles: true }));
assert.match(articleNode("subsection-form-description").textContent, /Other articles.*Other parent/);
studio.context.fetch = async path => { throw new Error(`Unexpected request while creating a board: ${path}`); };
studio.run('discardCurrentStudioDraft();enterSectionManager("gallery");editSubsection(app.subsections.find(item=>item.id==="photo-parent"))');
assert.equal(articleNode("create-subsection-child").disabled, false);
articleNode("create-subsection-child").click();
assert.equal(articleNode("subsection-section").value, "photos");
assert.equal(articleNode("subsection-parent").value, "photo-parent");
studio.run('editSubsection(app.subsections.find(item=>item.id==="photo-child"))');
articleNode("content-structure-new").click();
assert.equal(articleNode("subsection-parent").value, "photo-parent", "a child of a child remains under the saved small board");
articleNode("new-subsection").click();
assert.equal(articleNode("subsection-section").value, "photos");
assert.equal(articleNode("subsection-parent").value, "", "new small board does not inherit a child parent");
studio.run('enterSectionManager("resources")');
articleNode("create-subsection").click();
assert.equal(articleNode("subsection-section").value, "files");
studio.run('app.sections=[];enterSectionManager("content")');
assert.equal(articleNode("create-subsection").disabled, false);
assert.equal(articleNode("create-subsection-child").disabled, false);
articleNode("create-subsection").click();
articleNode("create-subsection-child").click();
assert.equal(studio.alerts.length, 2, "missing large boards receive visible feedback");
assert.ok(studio.alerts.every(message => /请先.*新建大板块/.test(message)));
studio.alerts.length = 0;
assert.equal(articleNode("content-structure-new").dataset.createLevel, "section");
articleNode("content-structure-new").click();
assert.equal(studio.run("app.sectionEditorLevel"), "section");
assert.equal(articleNode("section-kind").value, "content");
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
// The redesigned workspace uses real saved boards and content instead of an
// implicit creation form. It includes descendant drafts without changing scope
// when the article editor's own destination selects change.
async function workspaceFixture() {
  const fixture = domContext(studioHtml);
  for (const file of ["studio-upload", "studio-organize", "studio-share", "studio-background", "studio-rich-text", "studio-content"]) fixture.run(await readFile(`public/${file}.js`, "utf8"));
  fixture.run(main.replace("checkSession();", "")); return fixture;
}
const workspace = await workspaceFixture();
const workspaceSections = [...sections, { id: "other-articles", kind: "content", name: "Other essays", visibility: "private" }];
const workspaceSubsections = [...subsections, { id: "essay-parent", section_id: "articles", name: "Linux" }, { id: "essay-child", section_id: "articles", parent_id: "essay-parent", name: "Kernel" }];
const workspaceArticles = [
  { id: "root-essay", section_id: "articles", title: "Root essay", status: "published", body_html: "<p>root</p>" },
  { id: "child-essay", section_id: "articles", subsection_id: "essay-child", title: "Kernel diary", excerpt: "memory maps", status: "draft", body_html: "<p>Keep <strong>formatting</strong></p>" },
  { id: "outside-essay", section_id: "other-articles", title: "Other essay", status: "published", body_html: "<p>outside</p>" },
];
workspace.run(`app.sections=${JSON.stringify(workspaceSections)};app.subsections=${JSON.stringify(workspaceSubsections)};app.content=${JSON.stringify(workspaceArticles)};refreshSectionOptions();enterSectionManager('content')`);
const wnode = id => workspace.document.getElementById(id);
assert.equal(wnode("section-id").value, "articles");
assert.equal(wnode("content-settings-panel").hidden, true);
assert.equal(wnode("content-form").hidden, true);
assert.equal(workspace.document.querySelectorAll("#content-list button").length, 2);
assert.ok(!wnode("studio-primary-nav").classList.contains("hidden"));
assert.equal(wnode("studio-content-navigation").closest(".view").id, "view-sections");
wnode("content-list-status").value = "draft"; wnode("content-list-status").dispatchEvent(new workspace.window.Event("change"));
assert.equal(workspace.document.querySelectorAll("#content-list button").length, 1);
wnode("content-list-status").value = ""; wnode("content-search").value = "memory maps"; wnode("content-search").dispatchEvent(new workspace.window.Event("input"));
assert.match(wnode("content-list").textContent, /Kernel diary/);
wnode("content-search").value = ""; wnode("content-search").dispatchEvent(new workspace.window.Event("input"));
wnode("content-board-search").value = "kernel"; wnode("content-board-search").dispatchEvent(new workspace.window.Event("input"));
assert.deepEqual([...workspace.document.querySelectorAll("#content-structure-nav button")].map(control => control.dataset.boardId), ["articles", "essay-parent", "essay-child"]);
workspace.document.querySelector('[data-board-id="essay-parent"]').click();
assert.equal(workspace.document.querySelectorAll("#content-list button").length, 1, "a parent includes its child's draft");
workspace.document.querySelector("#content-list button").click();
assert.equal(wnode("content-form").hidden, false); assert.equal(wnode("content-title").value, "Kernel diary");
assert.equal(wnode("subsection-id").value, "essay-parent", "opening a descendant article keeps the catalog's scope");
assert.equal(wnode("content-subsection").value, "essay-child");
const keptBody = wnode("content-editor").innerHTML;
wnode("content-title").value = "Unsaved title"; wnode("content-title").dispatchEvent(new workspace.window.Event("input", { bubbles: true }));
workspace.context.confirm = () => false;
assert.equal(workspace.run("enterSectionManager('gallery')"), false);
assert.equal(workspace.run("enterSectionManager('content')"), true, "re-entering the active category is a no-op");
workspace.document.querySelector('[data-board-id="articles"]').click();
assert.equal(wnode("content-title").value, "Unsaved title"); assert.equal(wnode("content-editor").innerHTML, keptBody);
wnode("content-document-close").click(); assert.equal(wnode("content-form").hidden, false);
workspace.context.confirm = () => true; wnode("content-document-close").click();
assert.equal(wnode("content-form").hidden, true);
workspace.document.querySelector('[data-board-id="essay-child"]').click();
wnode("new-content").click();
assert.equal(wnode("content-title").value, ""); assert.equal(wnode("content-subsection").value, "essay-child");
assert.equal(wnode("content-settings-panel").hidden, true);
workspace.run("enterSectionManager('gallery');enterSectionManager('content')");
assert.equal(wnode("subsection-id").value, "essay-child");
wnode("create-subsection").click();
assert.equal(wnode("content-settings-panel").hidden, false); assert.equal(wnode("content-editor-open").disabled, true);
assert.match(wnode("content-selection-title").textContent, /新建小板块/);
assert.ok(workspace.document.querySelector('[data-board-id="essay-child"]'), "creation never removes the saved catalog");
workspace.run("enterSectionManager('gallery')");
wnode("media-subsection").value = "photo-child";
wnode("media-subsection").dispatchEvent(new workspace.window.Event("change", { bubbles: true }));
assert.equal(wnode("subsection-id").value, "photo-child", "filter controls keep the catalog selection in sync");
assert.equal(wnode("content-selection-title").textContent, "Child");
workspace.run("enterSectionManager('resources')");
wnode("asset-subsection").value = "file-parent";
wnode("asset-subsection").dispatchEvent(new workspace.window.Event("change", { bubbles: true }));
assert.equal(wnode("subsection-id").value, "file-parent");
assert.equal(wnode("content-selection-title").textContent, "Docs");

// Failed or delayed reads are surfaced as loading/retry states, never as a
// claim that the owner has no saved boards. A retry reconciles the selection.
const loadingWorkspace = await workspaceFixture();
loadingWorkspace.run("enterSectionManager('content')");
let failSectionRead = true, resumeSectionRead;
let sectionReadDelay = new Promise(resolve => { resumeSectionRead = resolve; });
loadingWorkspace.context.fetch = async path => {
  if (path === "/api/admin/sections") {
    if (sectionReadDelay) await sectionReadDelay;
    if (failSectionRead) return Response.json({ error: "test network failure" }, { status: 503 });
    return Response.json(workspaceSections);
  }
  return Response.json(path === "/api/admin/subsections" ? workspaceSubsections : path === "/api/admin/content" ? workspaceArticles : []);
};
const pendingWorkspaceRead = loadingWorkspace.run("loadStudioContentData({initial:true})");
await new Promise(resolve => setImmediate(resolve));
assert.equal(loadingWorkspace.run("studioWorkspace.status"), "loading");
assert.match(loadingWorkspace.document.getElementById("content-workspace-empty-text").textContent, /正在加载/);
resumeSectionRead(); assert.equal(await pendingWorkspaceRead, false);
assert.equal(loadingWorkspace.run("studioWorkspace.status"), "error");
assert.match(loadingWorkspace.document.getElementById("content-workspace-empty-text").textContent, /加载失败.*刷新/);
failSectionRead = false; sectionReadDelay = null;
assert.equal(await loadingWorkspace.run("loadStudioContentData()"), true);
assert.equal(loadingWorkspace.run("studioWorkspace.status"), "ready");
assert.equal(loadingWorkspace.document.getElementById("section-id").value, "articles");
assert.equal(loadingWorkspace.document.querySelectorAll("#content-list button").length, 2);
// Local article pictures use the same cancellable uploader. Editor previews
// use the admin route, while saving produces canonical public media URLs.
const images = await workspaceFixture(), uploadedImages = [], imageInsertions = [];
images.run(`app.sections=${JSON.stringify(workspaceSections)};app.subsections=${JSON.stringify(workspaceSubsections)};app.content=${JSON.stringify(workspaceArticles)};refreshSectionOptions();enterSectionManager('content');startStudioArticle()`);
images.context.getSelection = () => ({ rangeCount: 0 });
let imageNumber = 0, resolveLateImage;
images.context.photoUploadStub = async (file, fields, options) => {
  uploadedImages.push({ name: file.name, fields: { ...fields }, preview: options.requiredPreview });
  if (file.name === "failure.png") throw new Error("test upload failure");
  const item = { id: `article-image-${++imageNumber}`, kind: "inline", filename: file.name, content_id: fields.contentId || null };
  if (file.name === "late.png") return new Promise(resolve => { resolveLateImage = () => resolve(item); });
  if (file.name === "stop.png") images.run("stopAllStudioUploads()");
  return item;
};
images.context.recordImageInsertion = (item, file, options) => imageInsertions.push({ id: item.id, name: file.name, droppedAtPointer: Boolean(options.range?.fromDrop) });
images.run(`postStudioPhoto=photoUploadStub;
  insertInlineImageAtEditorRange=(item,file,options={})=>{recordImageInsertion(item,file,options);const editor=document.getElementById('content-editor');editor.append(studioArticleImageElement(item,file));editor.dispatchEvent(new Event('input',{bubbles:true}));return options.range||null};`);
const inode = id => images.document.getElementById(id), settleImages = async () => { for (let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve)); };
const coverFile = new File(["local-cover"], "cover.png", { type: "image/png" });
Object.defineProperty(inode("content-cover-file"), "files", { configurable: true, value: [coverFile] });
let coverPickerOpens = 0; inode("content-cover-file").click = () => { coverPickerOpens++; };
inode("content-cover-upload").click(); inode("content-cover-preview").click(); assert.equal(coverPickerOpens, 2);
inode("content-cover-file").dispatchEvent(new images.window.Event("change", { bubbles: true })); await settleImages();
const selectedLocalCover = inode("content-cover").value;
assert.ok(selectedLocalCover); assert.match(inode("content-cover-preview").querySelector("img").src, /^\/api\/admin\/media\//);
assert.equal(imageInsertions.length, 0, "a cover is not inserted into the body");
assert.equal(uploadedImages[0].fields.kind, "inline"); assert.equal(uploadedImages[0].preview, true);
assert.equal(images.run("studioDirtyForms.has(document.getElementById('content-form'))"), true);
function dropImages(target, files) {
  const event = new images.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"] } });
  target.dispatchEvent(event); return event;
}
images.context.failureImage = new File(["failure"], "failure.png", { type: "image/png" });
await images.run("uploadStudioArticleImages([failureImage],'cover')");
assert.equal(inode("content-cover").value, selectedLocalCover); assert.match(inode("content-cover-notice").textContent, /test upload failure/);
const uploadsBeforeInvalid = uploadedImages.length;
dropImages(inode("content-cover-preview"), [new File(["script"], "bad.svg", { type: "image/svg+xml" })]); await settleImages();
assert.equal(uploadedImages.length, uploadsBeforeInvalid); assert.equal(inode("content-cover").value, selectedLocalCover);
images.run("document.caretRangeFromPoint=()=>({commonAncestorContainer:document.getElementById('content-editor'),fromDrop:true,cloneRange(){return this}})");
assert.equal(dropImages(inode("content-editor"), [new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.png", { type: "image/png" })]).defaultPrevented, true);
await settleImages();
assert.deepEqual(imageInsertions.map(item => item.name), ["one.jpg", "two.png"]);
assert.ok(imageInsertions.every(item => item.droppedAtPointer));
assert.ok([...inode("content-cover").options].some(option => option.value === imageInsertions[0].id), "pictures added to an unsaved article are also available as its cover");
const serializedArticle = images.run("contentPayload()");
assert.equal(serializedArticle.coverMediaId, selectedLocalCover);
assert.ok(serializedArticle.bodyHtml.includes('/media/article-image-'));
assert.ok(!serializedArticle.bodyHtml.includes('/api/admin/') && !serializedArticle.bodyHtml.includes('data-studio-media-id'));
assert.ok(!serializedArticle.bodyHtml.includes('blob:') && !serializedArticle.bodyHtml.includes('file:'));
const pasted = new images.window.Event("paste", { bubbles: true, cancelable: true });
Object.defineProperty(pasted, "clipboardData", { value: { files: [new File(["paste"], "paste.png", { type: "image/png" })] } });
inode("content-editor").dispatchEvent(pasted); await settleImages(); assert.equal(pasted.defaultPrevented, true);
assert.equal(imageInsertions.at(-1).name, "paste.png");
const outsideDrop = dropImages(images.document.body, [coverFile]); assert.equal(outsideDrop.defaultPrevented, true);
assert.match(inode("content-notice").textContent, /封面区域或正文/);
images.context.cancelFiles = [new File(["stop"], "stop.png", { type: "image/png" }), new File(["later"], "later.png", { type: "image/png" })];
const uploadsBeforeStop = uploadedImages.length; await images.run("uploadStudioArticleImages(cancelFiles)");
assert.equal(uploadedImages.length, uploadsBeforeStop + 1); assert.ok(!imageInsertions.some(item => item.name === "stop.png"));
assert.equal(images.run("studioUploadBatches.size"), 0); assert.equal(inode("content-form").querySelector('button[type="submit"]').disabled, false);
inode("content-cover-clear").click(); assert.equal(inode("content-cover").value, "");
images.run("studioDirtyForms.clear();editContent(app.content[0])");
images.context.lateImage = new File(["late"], "late.png", { type: "image/png" });
const pendingLocalCover = images.run("uploadStudioArticleImages([lateImage],'cover')"); await settleImages();
assert.equal(inode("content-form").querySelector('button[type="submit"]').disabled, true);
assert.equal(uploadedImages.at(-1).fields.contentId, "root-essay");
images.run("editContent(app.content.find(item=>item.id==='outside-essay'))"); resolveLateImage(); await pendingLocalCover;
assert.equal(inode("content-id").value, "outside-essay"); assert.equal(inode("content-cover").value, "", "an old upload cannot replace the next article's cover");
assert.ok(![...inode("content-cover").options].some(option => option.value === selectedLocalCover), "the next article does not inherit the previous draft's local-cover choices");
assert.equal(inode("content-cover-notice").textContent, "");
images.run("document.getElementById('content-editor').innerHTML='<p>Saved body</p><img src=\"/media/saved-image?preview=1\">';hydrateStudioArticleImages()");
assert.match(inode("content-editor").querySelector("img").src, /\/api\/admin\/media\/saved-image/);
assert.match(images.run("studioArticleBodyHtml()"), /src="\/media\/saved-image\?preview=1"/);
console.log("local article images, cover picker/drop, paste, serialization, cancellation, stale uploads, catalog and permission workflows passed");
