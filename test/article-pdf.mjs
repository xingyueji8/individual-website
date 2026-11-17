import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const html = await readFile("public/index.html", "utf8");
const helper = await readFile("public/article-pdf.js", "utf8");
const { document, HTMLElement } = parseHTML(html);
const fetches = [], progress = [], alerts = [];
let failSource = "", decodeFailure = false, pendingDecode = null;
let active = 0, peak = 0, saves = 0, rendered = null;
class Reader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
      this.onload();
    }, () => this.onerror());
  }
}
HTMLElement.prototype.decode = async function () {
  assert.equal(this.getAttribute("loading"), "eager");
  assert.equal(this.getAttribute("decoding"), "sync");
  assert.equal(this.hasAttribute("srcset"), false);
  assert.match(this.src, /^data:image\//);
  if (decodeFailure) throw new Error("decode failed");
  if (pendingDecode) await pendingDecode;
};
const context = vm.createContext({
  document, URL, AbortController, FileReader: Reader, setTimeout, clearTimeout, console,
  location: { href: "https://example.test/", origin: "https://example.test" },
  window: {},
  fetch: async source => {
    fetches.push(source); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return new Response("PNG-BYTES", { status: source === failSource ? 403 : 200, headers: { "content-type": "image/png" } });
  },
});
const run = code => vm.runInContext(code, context);
run(helper);
const prepare = run("XYJArticlePdf.prepareImages");
const root = document.createElement("article");
root.innerHTML = '<img src="/media/one?preview=1" loading="lazy" srcset="/media/original 2x"><img src="/media/one?preview=1"><img src="/media/two?preview=1"><img src="/media/three?preview=1"><img src="/media/four?preview=1">';
let releaseDecode;
pendingDecode = new Promise(resolve => { releaseDecode = resolve; });
let prepared = false;
const preparing = prepare(root, { onProgress: (...values) => progress.push(values) }).then(() => { prepared = true; });
await new Promise(resolve => setImmediate(resolve));
assert.equal(prepared, false, "rendering waits for image decoding, including off-screen images");
releaseDecode(); await preparing; pendingDecode = null;
assert.equal(fetches.length, 4, "repeated images reuse the same bytes");
assert.ok(peak <= 3, "large articles must not fetch every image simultaneously");
assert.deepEqual(progress.at(-1), [5, 5]);
assert.ok([...root.querySelectorAll("img")].every(image => image.src.startsWith("data:image/png;base64,")));

failSource = "/media/denied";
root.innerHTML = '<img src="/media/denied">';
await assert.rejects(prepare(root), /第 1 张图片.*403/);
failSource = ""; decodeFailure = true;
root.innerHTML = '<img src="/media/broken">';
await assert.rejects(prepare(root), /第 1 张图片.*decode failed/);
decodeFailure = false;
root.innerHTML = '<img src="data:image/png;base64,UE5H">';
pendingDecode = new Promise(() => {});
await assert.rejects(prepare(root, { timeoutMs: 10 }), /解码超时/);
pendingDecode = null;

// Main reader: export the newly authorised server body, not the live reader's
// stale/lazy DOM; restricted inline images are never fetched or included.
run(html.slice(html.indexOf("    function pdfFilename("), html.indexOf("    /* ---------- 09.")));
context.state = { currentContent: { id: "article", title: "旧标题", canDownload: true } };
context.ensurePdfLibrary = async () => {};
context.enhanceArticleLinks = () => {};
context.contentTimeLabels = () => ({ published: "发布时间", updated: "修改时间" });
context.applyPdfWatermark = () => {};
context.showAuthLock = () => { throw new Error("unexpected auth prompt"); };
context.alert = message => alerts.push(message);
context.mediaIdFromUrl = value => new URL(value, "https://example.test/").pathname.match(/^\/media\/([^/]+)$/)?.[1] || "";
context.protectedMediaUrl = source => source + "&grants=current";
const apiCalls = [];
context.api = async path => {
  apiCalls.push(path);
  return { id: "article", title: "新标题", body_html: '<p>最新正文</p><img src="/media/allowed?preview=1"><img src="/media/private?preview=1"><div class="resource-embed">视频占位</div>',
    inlineMedia: [{ id: "allowed", canDownload: true, locked: false }, { id: "private", canDownload: false, locked: false }] };
};
context.window.html2pdf = () => { throw new Error("the reader must use the bounded page renderer"); };
context.XYJArticlePdf = {
  prepareImages: prepare,
  render: async element => {
    rendered = element.cloneNode(true);
    return { save: async filename => { assert.equal(filename, "新标题.pdf"); saves++; } };
  },
};
document.getElementById("reader-body").innerHTML = '<img src="/media/stale" loading="lazy">';
fetches.length = 0;
await run('downloadCurrentContentPdf(document.getElementById("content-pdf"))');
assert.equal(saves, 1); assert.deepEqual(apiCalls, ["/api/content/article?download=1", "/api/content/article?download=1"]);
assert.match(rendered.textContent, /新标题.*最新正文.*此图片未开放下载/s);
assert.equal(rendered.querySelectorAll("img").length, 1);
assert.match(rendered.querySelector("img").src, /^data:image\/png;base64,/);
assert.deepEqual(fetches, ["/media/allowed?preview=1&grants=current"]);
assert.equal(rendered.querySelector(".resource-embed"), null);
assert.equal(document.querySelector(".pdf-export"), null);
assert.equal(document.querySelector("#reader-body img").getAttribute("loading"), "lazy", "export preparation does not change the reading view");
failSource = fetches[0];
await run('downloadCurrentContentPdf(document.getElementById("content-pdf"))');
assert.equal(saves, 1, "image failures must not silently produce an incomplete PDF");
assert.match(alerts.at(-1), /第 1 张图片.*403/);
assert.equal(document.querySelector(".pdf-export"), null);
assert.equal(document.getElementById("content-pdf").disabled, false);

// Share exports use the same preparation while retaining scoped media URLs.
const shareHtml = await readFile("public/share.html", "utf8");
const shareDom = parseHTML(shareHtml), token = "b".repeat(64), prefix = `/api/shares/${token}`;
shareDom.HTMLElement.prototype.showModal = function () { this.open = true; };
shareDom.HTMLElement.prototype.close = function () { this.open = false; this.dispatchEvent(new shareDom.Event("close")); };
let revoked = false, revokeWhileLoading = false, shareSaves = 0, shareRendered;
const shareCalls = [];
const shareContext = vm.createContext({
  document: shareDom.document, window: {}, URL, AbortController, FileReader: Reader, setTimeout, clearTimeout, setInterval() {},
  location: { pathname: `/share/${token}`, href: `https://example.test/share/${token}`, origin: "https://example.test" },
  fetch: async path => {
    shareCalls.push(path);
    if (path === "/api/auth/session") return Response.json({ user: null });
    if (revoked) return Response.json({ error: "分享已撤回" }, { status: 410 });
    if (path === prefix) return Response.json({ kind: "content", targetId: "article", title: "分享文章", canDownload: true, content: [], media: [], assets: [], subsections: [] });
    if (path.startsWith(prefix + "/content/")) return Response.json({ id: "article", title: "分享文章", canDownload: true, body_html: `<img src="${prefix}/media/image?preview=1">` });
    assert.equal(path, prefix + "/media/image?preview=1");
    if (revokeWhileLoading) revoked = true;
    return new Response("PNG-BYTES", { headers: { "content-type": "image/png" } });
  },
});
shareDom.HTMLElement.prototype.decode = HTMLElement.prototype.decode;
const shareRun = code => vm.runInContext(code, shareContext);
shareContext.window.html2pdf = () => { throw new Error("shares must use the bounded page renderer"); };
shareRun(helper);
shareContext.XYJArticlePdf = {
  prepareImages: shareRun("XYJArticlePdf.prepareImages"),
  render: async element => {
    shareRendered = element.cloneNode(true);
    return { save: async () => { shareSaves++; } };
  },
};
shareRun(await readFile("public/share.js", "utf8"));
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
await settle();
shareDom.document.getElementById("share-pdf").click(); await settle();
assert.equal(shareSaves, 1);
assert.match(shareRendered.querySelector("img").src, /^data:image\/png;base64,/);
assert.ok(shareCalls.includes(prefix + "/media/image?preview=1"));
assert.ok(!shareCalls.some(path => path.startsWith("/media/")));
assert.equal(shareDom.document.querySelector(".share-pdf-export"), null);
revokeWhileLoading = true;
shareDom.document.getElementById("share-pdf").click(); await settle();
assert.equal(shareSaves, 1, "a share revoked during image preparation must not finish downloading");
assert.equal(shareDom.document.querySelector(".share-pdf-export"), null);
assert.equal(shareDom.document.getElementById("share-title").textContent, "分享链接已失效");
console.log("PDF eager decoding, embedded images, bounded requests, explicit failures, fresh bodies, download permissions and scoped sharing passed");
