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
  HTMLElement.prototype.reset = function () {
    this.querySelectorAll("input,textarea").forEach(input => { input.value = input.getAttribute("value") || ""; });
    this.querySelectorAll("select").forEach(select => { select.value = select.options[0]?.value || ""; });
  };
  HTMLElement.prototype.showModal = function () { this.open = true; };
  HTMLElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  const intervals = [], alerts = [];
  window.setInterval = callback => { intervals.push(callback); return 0; };
  const context = vm.createContext({ window, document, Element: window.Element, Node: window.Node, Event: window.Event, console,
    URL, crypto: webcrypto, Response, File, Blob, FormData, TextEncoder, performance,
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
for (const filename of ["studio-organize.js", "studio-background.js", "studio-share.js", "studio-rich-text.js"]) studio.run(await readFile("public/" + filename, "utf8"));
const main = [...studioHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("const app ="));
studio.run(main.replace("checkSession();", ""));
studio.run(`app.sections=[{id:'articles',kind:'content',name:'文章',visibility:'public',show_all:1},{id:'photos',kind:'gallery',name:'图片',show_all:1}];
  app.subsections=[{id:'board',name:'分享板块',section_id:'articles',visibility:'private'}];
  app.content=[{id:'article',title:'已保存文章',status:'published',visibility:'private',section_id:'articles',subsection_id:'board',body_html:'<p>保存的正文</p>'}];
  app.media=[{id:'photo',kind:'photo',filename:'photo.png',visibility:'private',section_id:'photos'}];
  app.users=[];refreshSectionOptions();enterSectionManager('content');editContent(app.content[0]);`);
const calls = [], clipboard = [], targets = [{ kind: "content", id: "article" }];
let clipboardFails = true, activationFails = false;
studio.context.navigator.clipboard = { writeText: async url => { clipboard.push(url); if (clipboardFails) throw new Error("Clipboard denied"); } };
studio.context.mockApi = async (path, init) => {
  calls.push({ path, body: JSON.parse(init.body) });
  if (path === "/api/admin/shares") return { token: "a".repeat(64), url: "https://example.test/share/" + "a".repeat(64), title: "已保存文章", summary: { content: 1, media: 0, asset: 0, subsection: 1 } };
  if (activationFails) throw new Error("权限已改变");
  return { ok: true, targets };
};
studio.run("api=mockApi");
assert.equal(studio.document.getElementById("content-share").type, "button");
studio.document.getElementById("content-share").click(); await settle();
const shareDialog = studio.document.querySelector(".studio-share-dialog"); assert.ok(shareDialog?.open);
const buttons = [...shareDialog.querySelectorAll("button")];
assert.ok(buttons.some(button => button.textContent === "分享这篇文章"));
const boardChoice = buttons.find(button => button.textContent.includes("分享小板块「")); assert.ok(boardChoice);
assert.ok(shareDialog.textContent.includes("浏览和下载"));
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
boardChoice.click(); await settle();
assert.deepEqual(calls.at(-1).body, { kind: "subsection", id: "board" });
activationFails = true; copy.click(); await settle();
assert.ok(shareDialog.textContent.includes("但未能确认权限开放成功"));
assert.equal(studio.run("app.subsections[0].visibility"), "private");
shareDialog.close();
studio.run("studioDirtyForms.add(document.getElementById('content-form'))");
const before = calls.length; studio.document.getElementById("content-share").click(); await settle();
assert.equal(calls.length, before); assert.match(studio.alerts.at(-1), /先保存/);
studio.run("studioDirtyForms.clear();renderMedia()");
assert.ok(studio.document.querySelector('[data-share-kind="media"][data-share-id="photo"]'));

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
  if (path === prefix) return Response.json({ kind: "subsection", targetId: "board", title: "分享范围", description: "", content: [{ id: "shared", title: "分享文章", subsectionId: "board" }],
    media: [{ id: "photo", title: "分享图片", role: "item", subsectionId: "board", url: prefix + "/media/photo?preview=1", downloadUrl: prefix + "/media/photo?download=1" }], assets: [], subsections: [{ id: "board", name: "小板块" }] });
  if (path === prefix + "/content/shared") return Response.json({ id: "shared", title: "分享文章", body_html: '<p>共享正文</p><a href="/#about">关于我</a>', published_at: new Date().toISOString(), updated_at: new Date().toISOString() });
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
console.log("share selection, clipboard failures, permission reflection, visitor login gate and active-page revocation passed");
