import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { parseHTML } from "linkedom";

function dom(html, pathname = "/studio") {
  const window = parseHTML(html), { document, HTMLElement, HTMLSelectElement, HTMLInputElement } = window;
  Object.defineProperty(HTMLSelectElement.prototype, "value", { configurable: true,
    get() { return (this.querySelector("option[selected]") || this.options[0])?.value || ""; },
    set(value) { [...this.options].forEach(option => option.toggleAttribute("selected", option.value === String(value))); } });
  HTMLSelectElement.prototype.add = function (option) { this.append(option); };
  Object.defineProperty(HTMLInputElement.prototype, "checked", { configurable: true,
    get() { return this.hasAttribute("checked"); }, set(value) { this.toggleAttribute("checked", Boolean(value)); } });
  HTMLInputElement.prototype.select = function () {};
  HTMLElement.prototype.reset = function () {
    this.querySelectorAll("input,textarea").forEach(input => { input.value = input.getAttribute("value") || ""; });
    this.querySelectorAll("select").forEach(select => { select.value = select.options[0]?.value || ""; });
  };
  HTMLElement.prototype.showModal = function () { this.open = true; };
  HTMLElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  const intervals = [], alerts = [];
  window.setInterval = callback => { intervals.push(callback); return 0; };
  const context = vm.createContext({ window, document, Element: window.Element, Node: window.Node, Event: window.Event, console,
    URL, crypto: webcrypto, Response, File, Blob, FormData, TextEncoder, performance, AbortController,
    setTimeout, clearTimeout, setInterval: callback => { intervals.push(callback); return 0; },
    location: { pathname, href: "https://example.test" + pathname, origin: "https://example.test" },
    navigator: { onLine: true }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    alert: message => alerts.push(message), confirm: () => true, prompt: () => null,
    fetch: async path => { throw new Error(`Unexpected fetch: ${path}`); },
    Option: function (text, value) { const option = document.createElement("option"); option.textContent = text; option.value = value; return option; } });
  return { context, document, window, intervals, alerts, run: source => vm.runInContext(source, context) };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const studioHtml = await readFile("public/studio.html", "utf8"), studio = dom(studioHtml);
for (const filename of ["studio-upload.js", "studio-organize.js", "studio-background.js", "studio-share.js", "studio-rich-text.js"]) studio.run(await readFile("public/" + filename, "utf8"));
const main = [...studioHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("const app ="));
studio.run(main.replace("checkSession();", ""));
studio.run(`app.sections=[{id:'articles',kind:'content',name:'文章',visibility:'public',show_all:1},{id:'photos',kind:'gallery',name:'图片',show_all:1}];
  app.subsections=[{id:'board',name:'分享板块',section_id:'articles',visibility:'private'}];
  app.content=[{id:'article',title:'已保存文章',status:'published',visibility:'private',section_id:'articles',subsection_id:'board',body_html:'<p>保存的正文</p>'}];
  app.media=[{id:'photo',kind:'photo',filename:'photo.png',visibility:'private',section_id:'photos'}];
  app.users=[];refreshSectionOptions();enterSectionManager('content');editContent(app.content[0]);`);
const calls = [], clipboard = [], targets = [{ kind: "content", id: "article" }];
let clipboardFails = true, activationFails = false, renameFails = false, nextToken = 0;
const shareModes = new Map();
studio.context.navigator.clipboard = { writeText: async url => { clipboard.push(url); if (clipboardFails) throw new Error("Clipboard denied"); } };
studio.context.mockApi = async (path, init) => {
  calls.push({ path, body: JSON.parse(init.body) });
  if (init.method === "PATCH") {
    if (renameFails) throw new Error("名称保存失败");
    return { id: path.split("/").at(-1), name: JSON.parse(init.body).name, updated_at: new Date().toISOString() };
  }
  if (path === "/api/admin/shares") {
    const token = (++nextToken).toString(16).padStart(64, "0"), allowDownload = JSON.parse(init.body).allowDownload;
    shareModes.set(token, allowDownload);
    return { token, allowDownload, url: "https://example.test/share/" + token, title: "已保存文章", summary: { content: 1, media: 0, asset: 0, subsection: 1 } };
  }
  if (activationFails) throw new Error("权限已改变");
  return { ok: true, targets, allowDownload: shareModes.get(path.split("/").at(-2)) };
};
studio.run("api=mockApi");
assert.equal(studio.document.getElementById("content-share").type, "button");
studio.document.getElementById("content-share").click(); await settle();
const shareDialog = studio.document.querySelector(".studio-share-dialog"); assert.ok(shareDialog?.open);
const buttons = [...shareDialog.querySelectorAll("button")];
assert.ok(buttons.some(button => button.textContent === "分享这篇文章"));
const boardChoice = buttons.find(button => button.textContent.includes("分享小板块「")); assert.ok(boardChoice);
assert.ok(shareDialog.textContent.includes("仅在线浏览"));
const downloadOption = shareDialog.querySelector('input[name="allowDownload"]');
assert.equal(downloadOption.checked, false); assert.equal(calls.at(-1).body.allowDownload, false);
const copy = buttons.find(button => button.textContent === "复制分享链接");
copy.click(); await settle();
assert.equal(calls.filter(call => call.path.includes("/activate")).length, 0, "failed clipboard must not open permissions");
assert.equal(studio.run("app.content[0].visibility"), "private");
assert.ok(shareDialog.textContent.includes("作品权限未改变"));
clipboardFails = false; copy.click(); await settle();
assert.equal(calls.filter(call => call.path.includes("/activate")).length, 1);
assert.equal(studio.run("app.content[0].visibility"), "public");
assert.equal(studio.document.getElementById("content-visibility").value, "public");
assert.ok(shareDialog.textContent.includes("已复制并生效"));
assert.ok(shareDialog.textContent.includes("未开放下载"));
assert.equal(studio.run("app.content[0].download_policy"), undefined);
downloadOption.checked = true; downloadOption.dispatchEvent(new studio.window.Event("change")); await settle();
assert.equal(calls.at(-1).body.allowDownload, true); copy.click(); await settle();
assert.ok(shareDialog.textContent.includes("对方可直接浏览和下载"));
assert.equal(studio.run("app.content[0].download_policy"), "public");
boardChoice.click(); await settle();
assert.deepEqual(calls.at(-1).body, { kind: "subsection", id: "board", allowDownload: true });
activationFails = true; copy.click(); await settle();
assert.ok(shareDialog.textContent.includes("但未能确认权限开放成功"));
assert.equal(studio.run("app.subsections[0].visibility"), "private");
shareDialog.close();
studio.run("studioDirtyForms.add(document.getElementById('content-form'))");
const before = calls.length; studio.document.getElementById("content-share").click(); await settle();
assert.equal(calls.length, before); assert.match(studio.alerts.at(-1), /先保存/);
studio.run("studioDirtyForms.clear();renderMedia()");
assert.ok(studio.document.querySelector('[data-share-kind="media"][data-share-id="photo"]'));

// The file toolbar shares the currently selected board, even if the editor
// panel is closed. A stale selection must never widen into a whole-board share.
activationFails = false; clipboardFails = false;
studio.run(`app.sections.push({id:'files-a',name:'文件 A',kind:'resources',visibility:'private',download_policy:'member'},
  {id:'files-b',name:'文件 B',kind:'resources',visibility:'private'});
  app.subsections.push({id:'files-small',section_id:'files-a',name:'文档',visibility:'private'},
  {id:'files-child',section_id:'files-a',parent_id:'files-small',name:'报告',visibility:'private'});
  enterSectionManager('resources');`);
const fileShareControl = studio.document.getElementById("asset-share-board");
assert.equal(fileShareControl.type, "button");
assert.equal(fileShareControl.textContent, "分享当前大板块");
fileShareControl.click(); await settle();
assert.deepEqual(calls.at(-1).body, { kind: "section", id: "files-a", allowDownload: false });
assert.equal(studio.run("app.sections.find(item=>item.id==='files-a').visibility"), "private");
let fileDialog = studio.document.querySelector(".studio-share-dialog");
assert.ok(fileDialog.textContent.includes("分享这个大板块"));
targets.splice(0, targets.length, { kind: "section", id: "files-a" });
[...fileDialog.querySelectorAll("button")].find(button => button.textContent === "复制分享链接").click(); await settle();
assert.equal(studio.run("app.sections.find(item=>item.id==='files-a').visibility"), "public");
assert.equal(studio.run("app.sections.find(item=>item.id==='files-a').download_policy"), "member");
assert.equal(studio.run("app.sections.find(item=>item.id==='files-b').visibility"), "private");
fileDialog.close();
for (const [id, label] of [["files-small", "小板块"], ["files-child", "小小板块"]]) {
  const select = studio.document.getElementById("asset-subsection"); select.value = id;
  select.dispatchEvent(new studio.window.Event("change", { bubbles: true }));
  assert.equal(fileShareControl.textContent, `分享当前${label}`);
  fileShareControl.click(); await settle();
  assert.deepEqual(calls.at(-1).body, { kind: "subsection", id, allowDownload: false });
  fileDialog = studio.document.querySelector(".studio-share-dialog");
  assert.ok(fileDialog.textContent.includes(`分享这个${label}`)); fileDialog.close();
}
studio.document.getElementById("asset-section").value = "files-b";
studio.document.getElementById("asset-section").dispatchEvent(new studio.window.Event("change", { bubbles: true }));
fileShareControl.click(); await settle();
assert.deepEqual(calls.at(-1).body, { kind: "section", id: "files-b", allowDownload: false });
studio.document.querySelector(".studio-share-dialog").close();
const staleOption = studio.document.createElement("option"); staleOption.value = "deleted-board";
studio.document.getElementById("asset-subsection").append(staleOption);
studio.document.getElementById("asset-subsection").value = "deleted-board";
const beforeInvalidBoard = calls.length; fileShareControl.click(); await settle();
assert.equal(calls.length, beforeInvalidBoard); assert.match(studio.alerts.at(-1), /重新选择/);

// A visible rename entry covers large/small/child boards and keeps the file
// browser's selected scope, folder, permissions and editor selection intact.
const renameButton = studio.document.getElementById("rename-current-board");
const submitRename = () => studio.document.querySelector(".studio-rename-dialog form").dispatchEvent(new studio.window.Event("submit", { bubbles: true, cancelable: true }));
assert.equal(renameButton.type, "button");
for (const [kind, id, nextName] of [["section", "files-a", "我的文件"], ["subsection", "files-small", "学习文档"], ["subsection", "files-child", "课程报告"]]) {
  studio.run(`edit${kind === "section" ? "Section" : "Subsection"}(app.${kind === "section" ? "sections" : "subsections"}.find(item=>item.id==='${id}'))`);
  renameButton.click(); await settle();
  const dialog = studio.document.querySelector(".studio-rename-dialog"); assert.ok(dialog.open);
  const input = dialog.querySelector('input[name="boardName"]');
  assert.equal(input.value, studio.run(`app.${kind === "section" ? "sections" : "subsections"}.find(item=>item.id==='${id}').name`));
  const callCount = calls.length; input.value = " "; submitRename(); await settle(); assert.equal(calls.length, callCount);
  input.value = nextName; submitRename(); await settle();
  assert.equal(studio.document.querySelector(".studio-rename-dialog"), null);
  assert.deepEqual(calls.at(-1), { path: `/api/admin/${kind === "section" ? "sections" : "subsections"}/${id}`, body: { name: nextName } });
  assert.equal(studio.document.getElementById(`${kind}-name`).value, nextName);
  assert.equal(studio.document.getElementById("asset-section").value, "files-a");
  if (kind === "subsection") assert.equal(studio.document.getElementById("asset-subsection").value, id);
  assert.ok(studio.document.getElementById("content-structure-nav").textContent.includes(nextName));
  assert.ok(studio.document.getElementById("content-inline-scope").textContent.includes(nextName));
}
studio.document.getElementById("asset-rename-board").click();
let renameDialog = studio.document.querySelector(".studio-rename-dialog"); assert.ok(renameDialog.textContent.includes("小小板块"));
renameFails = true; renameDialog.querySelector("input").value = "失败名称"; submitRename(); await settle();
assert.ok(renameDialog.textContent.includes("名称保存失败")); assert.equal(studio.run("app.subsections.find(item=>item.id==='files-child').name"), "课程报告");
renameDialog.close(); renameFails = false;
studio.run("resetSubsectionForm();setSectionEditorLevel('subsection')");
const beforeUnsavedRename = calls.length; renameButton.click(); assert.equal(calls.length, beforeUnsavedRename); assert.match(studio.alerts.at(-1), /先选择一个已保存/);
studio.run("editSection(app.sections.find(item=>item.id==='files-a'));markStudioDirty(document.getElementById('section-form'))");
renameButton.click(); assert.match(studio.alerts.at(-1), /先保存当前修改/); studio.run("studioDirtyForms.clear()");

// A slow response for the previous mode must not replace the newly chosen link.
const normalApi = studio.context.mockApi; let releasePreviousMode;
studio.context.mockApi = async (path, init) => {
  const result = await normalApi(path, init);
  if (path === "/api/admin/shares" && !JSON.parse(init.body).allowDownload) return new Promise(resolve => { releasePreviousMode = () => resolve(result); });
  return result;
};
studio.run("api=mockApi;openStudioShare('section',app.sections.find(item=>item.id==='files-a'))"); await settle();
const raceDialog = studio.document.querySelector(".studio-share-dialog"), raceChoice = raceDialog.querySelector("input");
raceChoice.checked = true; raceChoice.dispatchEvent(new studio.window.Event("change")); await settle();
const newestToken = nextToken.toString(16).padStart(64, "0");
releasePreviousMode(); await settle();
[...raceDialog.querySelectorAll("button")].find(control => control.textContent === "复制分享链接").click(); await settle();
assert.equal(calls.at(-1).path, `/api/admin/shares/${newestToken}/activate`);
assert.ok(raceDialog.textContent.includes("对方可直接浏览和下载")); raceDialog.close();
studio.context.mockApi = normalApi; studio.run("api=mockApi");
studio.context.mockApi = async (path, init) => { const result = await normalApi(path, init); delete result.allowDownload; return result; };
studio.run("api=mockApi;openStudioShare('section',app.sections.find(item=>item.id==='files-a'))"); await settle();
const outdatedDialog = studio.document.querySelector(".studio-share-dialog");
assert.ok(outdatedDialog.textContent.includes("分享权限状态未同步"));
assert.equal([...outdatedDialog.querySelectorAll("button")].find(control => control.textContent === "复制分享链接").disabled, true);
outdatedDialog.close(); studio.context.mockApi = normalApi; studio.run("api=mockApi");

// Share visitors can navigate within the shared list, but every outside click
// opens registration/login without requesting the normal site bootstrap.
const token = "b".repeat(64), prefix = `/api/shares/${token}`;
const viewer = dom(await readFile("public/share.html", "utf8"), `/share/${token}`);
const viewCalls = [];
let revoked = false;
viewer.context.fetch = async path => {
  viewCalls.push(path);
  if (path === "/api/auth/session") return Response.json({ authenticated: false, user: null });
  if (revoked) return Response.json({ error: "站长已收回权限" }, { status: 410 });
  if (path === prefix) return Response.json({ canDownload: true, kind: "subsection", targetId: "board", title: "分享范围", description: "", content: [{ id: "shared", title: "分享文章", subsectionId: "board" }],
    media: [{ id: "photo", title: "分享图片", role: "item", subsectionId: "board", url: prefix + "/media/photo?preview=1", downloadUrl: prefix + "/media/photo?download=1" }], assets: [], subsections: [{ id: "board", name: "小板块" }] });
  if (path === prefix + "/content/shared") return Response.json({ canDownload: true, id: "shared", title: "分享文章", body_html: '<p>共享正文</p><a href="/#about">关于我</a>', published_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  throw new Error("Out of scope request: " + path);
};
viewer.run(await readFile("public/share.js", "utf8")); await settle();
assert.equal(viewer.document.getElementById("share-title").textContent, "分享范围");
function click(element, type = "click", button = 0) {
  const event = new viewer.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "button", { value: button }); element.dispatchEvent(event); return event;
}
const outside = viewer.document.querySelector('a[data-site-navigation][href="/#about"]');
assert.equal(click(outside).defaultPrevented, true);
assert.equal(viewer.document.getElementById("share-login-dialog").open, true);
assert.equal(viewer.document.getElementById("share-login").getAttribute("href"), "/login?next=%2F%23about");
assert.ok(!viewCalls.includes("/api/bootstrap"));
viewer.document.getElementById("share-login-dialog").close();
assert.equal(click(outside, "auxclick", 1).defaultPrevented, true);
viewer.document.getElementById("share-login-dialog").close();
const download = viewer.document.querySelector("a[data-share-resource]");
assert.equal(click(download).defaultPrevented, false); assert.equal(viewer.document.getElementById("share-login-dialog").open, false);
const openArticle = [...viewer.document.querySelectorAll("button")].find(button => button.textContent === "浏览文章");
openArticle.click(); await settle();
assert.equal(viewer.document.getElementById("share-reader").hidden, false);
assert.ok(viewer.document.getElementById("reader-body").textContent.includes("共享正文"));
assert.equal(click(viewer.document.querySelector("#reader-body a")).defaultPrevented, true);
revoked = true; await viewer.intervals[0](); await settle();
assert.equal(viewer.document.getElementById("reader-body").textContent, "");
assert.equal(viewer.document.getElementById("share-reader").hidden, true);
assert.equal(viewer.document.getElementById("share-title").textContent, "分享链接已失效");

const rootViewer = dom(await readFile("public/share.html", "utf8"), `/share/${token}`);
rootViewer.context.fetch = async path => {
  if (path === "/api/auth/session") return Response.json({ authenticated: false, user: null });
  assert.equal(path, prefix);
  return Response.json({ canDownload: true, kind: "section", targetId: "files-root", title: "文件大板块", description: "", content: [], media: [],
    subsections: [{ id: "docs", name: "文档" }, { id: "reports", name: "报告", parentId: "docs" }, { id: "other", name: "其他" }],
    assets: [
      { id: "root-file", title: "根目录文件", kind: "file", sizeBytes: 10, subsectionId: null, url: prefix + "/asset/root-file", downloadUrl: prefix + "/asset/root-file?download=1" },
      { id: "report-file", title: "子板块报告", kind: "file", sizeBytes: 10, subsectionId: "reports", url: prefix + "/asset/report-file", downloadUrl: prefix + "/asset/report-file?download=1" },
      { id: "other-file", title: "其他资料", kind: "file", sizeBytes: 10, subsectionId: "other", url: prefix + "/asset/other-file", downloadUrl: prefix + "/asset/other-file?download=1" },
    ] });
};
rootViewer.run(await readFile("public/share.js", "utf8")); await settle();
assert.equal(rootViewer.document.getElementById("share-folders").hidden, false);
assert.equal(rootViewer.document.querySelectorAll("#share-works .work-card").length, 3);
const docsFilter = [...rootViewer.document.querySelectorAll("#share-folders button")].find(control => control.textContent === "文档");
docsFilter.click();
assert.equal(rootViewer.document.querySelectorAll("#share-works .work-card").length, 1);
assert.ok(rootViewer.document.getElementById("share-works").textContent.includes("子板块报告"));
assert.ok(!rootViewer.document.getElementById("share-works").textContent.includes("其他资料"));

// Read-only viewers get preview controls and no download/export affordance,
// even if an unexpected download URL is present in the listing.
const readonlyViewer = dom(await readFile("public/share.html", "utf8"), `/share/${token}`), readonlyCalls = [];
readonlyViewer.context.fetch = async path => {
  readonlyCalls.push(path);
  if (path === "/api/auth/session") return Response.json({ user: null });
  if (path === prefix) return Response.json({ kind: "subsection", title: "仅浏览", canDownload: false, subsections: [],
    content: [{ id: "readonly", title: "文章" }],
    media: [{ id: "image", role: "item", title: "图片", url: `${prefix}/media/image?preview=1`, downloadUrl: `${prefix}/media/image?download=1` }],
    assets: [{ id: "video", kind: "video", title: "视频", sizeBytes: 10, url: `${prefix}/asset/video`, downloadUrl: `${prefix}/asset/video?download=1` },
      { id: "word", kind: "word", title: "文档", sizeBytes: 10, url: `${prefix}/asset/word`, previewUrl: `${prefix}/asset/word?variant=preview` },
      { id: "zip", kind: "archive", title: "压缩包", sizeBytes: 10, url: `${prefix}/asset/zip`, downloadUrl: `${prefix}/asset/zip?download=1` }] });
  if (path === `${prefix}/content/readonly`) return Response.json({ id: "readonly", title: "文章", canDownload: false, body_html: "<p>只读正文</p>" });
  throw new Error("Unexpected readonly request: " + path);
};
readonlyViewer.run(await readFile("public/share.js", "utf8")); await settle();
assert.equal(readonlyViewer.document.querySelectorAll('a[href*="download=1"]').length, 0);
assert.equal(readonlyViewer.document.querySelector("video").getAttribute("controlsList"), "nodownload");
assert.ok(readonlyViewer.document.querySelector('a[href$="?variant=preview"]'));
assert.ok(readonlyViewer.document.getElementById("share-works").textContent.includes("暂不支持在线预览"));
[...readonlyViewer.document.querySelectorAll("button")].find(control => control.textContent === "浏览文章").click(); await settle();
assert.equal(readonlyViewer.document.getElementById("share-pdf").hidden, true);
assert.ok(readonlyViewer.document.getElementById("reader-body").textContent.includes("只读正文"));
readonlyViewer.document.getElementById("share-pdf").click(); await settle();
assert.ok(!readonlyCalls.some(path => path.includes("download=1")));
console.log("share modes and races, clipboard failures, board renaming, readonly previews, login gate and active-page revocation passed");
