import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const html = await readFile("public/index.html", "utf8");
const { document } = parseHTML(html);
const state = { imageSequence: [], currentImageIndex: -1, imageTargetIndex: -1, imageRequestId: 0, preloadedImages: new Map(), data: {} };
const loads = [], releases = [], accessCalls = [];
const context = vm.createContext({
  document, state, URL, Map, Set, console, navigator: {},
  location: { href: "https://example.test/", origin: "https://example.test" },
  Image: function () { const image = document.createElement("img"); loads.push(image); return image; },
  clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)),
  mediaIdFromUrl: source => { try { return new URL(source, "https://example.test/").pathname.match(/^\/media\/([^/]+)$/)?.[1] || ""; } catch { return ""; } },
  hideImageBoundaryNotice() {}, resetImageZoom() {}, renderImageZoom() {}, syncProtectedDownloadControls() {},
  requestAnimationFrame: callback => callback(), showImageBoundaryNotice: message => { context.boundary = message; },
  fetch: async () => Response.json({ ok: true }), alert: () => {},
});
const run = code => vm.runInContext(code, context);
run(await readFile("public/portfolio-organize.js", "utf8"));
const realEnsure = run("ensureContentUnlocked");
context.ensureContentUnlocked = async (kind, item) => { accessCalls.push(item.id); item.locked = false; item.locks = []; return true; };
context.closeProtectedView = async owner => releases.push(owner);
run(html.slice(html.indexOf("    function warmImagePreview("), html.indexOf("    function imagePinchMetrics(")));
const preview = document.getElementById("image-preview");
const dialog = document.getElementById("image-dialog");
dialog.open = true;
dialog.showModal = () => { dialog.open = true; };
const photos = ["a", "b", "c", "d"].map(id => ({ id, locked: false, previewUrl: `/media/${id}?preview=1&v=updated`, caption: id }));
state.imageSequence = photos;

// Ordinary previews start without a separate access fetch and preserve v.
assert.equal(await run("showImageAt(0)"), true);
assert.deepEqual(accessCalls, []);
assert.equal(preview.src, "/media/a?preview=1&v=updated");
assert.equal(document.getElementById("image-load-status").hidden, false);
assert.equal(loads.length, 0, "neighbour downloads wait for the requested image");
preview.onload();
assert.equal(document.getElementById("image-load-status").hidden, true);
assert.equal(loads.length, 1);
assert.equal(loads[0].src, "/media/b?preview=1&v=updated");

// Two quick next presses advance twice; old async checks cannot put the first
// image back after a later selection is already on screen.
run("stepImage(1);stepImage(1);");
assert.equal(state.currentImageIndex, 2);
assert.equal(preview.src, "/media/c?preview=1&v=updated");
assert.deepEqual(accessCalls, []);
let finishUnlock;
context.ensureContentUnlocked = async (_, item) => {
  accessCalls.push(item.id);
  await new Promise(resolve => { finishUnlock = resolve; });
  item.locked = false; item.locks = []; return true;
};
photos[0].locked = true;
const slow = run("showImageAt(0)");
assert.equal(state.imageTargetIndex, 0);
assert.equal(await run("showImageAt(3)"), true);
finishUnlock();
assert.equal(await slow, false);
assert.equal(state.currentImageIndex, 3);
assert.equal(preview.src, "/media/d?preview=1&v=updated");
assert.ok(releases.includes("media:a"));

// A failed/newly locked byte request checks current access once and recovers;
// a repeated network/decode failure stays an error instead of a retry loop.
context.ensureContentUnlocked = async (_, item) => { accessCalls.push(item.id); return true; };
const beforeRecovery = accessCalls.length;
await preview.onerror();
assert.equal(accessCalls.length, beforeRecovery + 1);
await preview.onerror();
assert.equal(accessCalls.length, beforeRecovery + 1);
assert.match(document.getElementById("image-load-status").textContent, /加载失败/);

// Preloads are bounded, skip locked images, use current grants, and retry a
// failed download. Saving data disables speculative neighbours.
run("clearImagePreloads()");
photos[0].locked = false;
run(`contentViewGrants.set('media:test',{token:'${"a".repeat(64)}',expiresAt:Date.now()+10000,owner:'media:test'});`);
run("warmImagePreview(state.imageSequence[0])");
const firstWarm = loads.at(-1);
assert.match(firstWarm.src, /v=updated&grants=/);
firstWarm.onerror();
assert.equal(state.preloadedImages.size, 0);
run("state.imageSequence.forEach(photo => warmImagePreview(photo))");
assert.equal(state.preloadedImages.size, 3);
const count = loads.length;
photos[1].locked = true;
run("warmImagePreview(state.imageSequence[1])");
assert.equal(loads.length, count);
run("clearImagePreloads()");
context.navigator.connection = { saveData: true };
state.currentImageIndex = 2;
run("preloadAdjacentImages()");
assert.equal(state.preloadedImages.size, 0);

// Refreshing media access preserves the preview's cache/version key.
context.api = async () => ({ id: "versioned", locked: false, locks: [], canDownload: false });
const versioned = { id: "versioned", previewUrl: "/media/versioned?preview=1&v=2026-10-05" };
assert.equal(await realEnsure("media", versioned), true);
assert.equal(versioned.previewUrl, "/media/versioned?preview=1&v=2026-10-05");
assert.equal(versioned.downloadUrl, "");

// Article insertion configures lazy decoding before nodes enter the document.
context.enhanceArticleLinks = () => {};
run(html.slice(html.indexOf("    function renderReaderBody("), html.indexOf("    const IMAGE_ZOOM_MIN")));
run(`renderReaderBody('<img src="/media/versioned" alt="test">',{content:{id:'article',inlineMedia:[]}})`);
const inline = document.querySelector("#reader-body img");
assert.equal(inline.getAttribute("loading"), "lazy");
assert.equal(inline.getAttribute("decoding"), "async");
assert.match(inline.src, /preview=1/);
console.log("immediate preview, quick pagination, stale-result protection, recovery, bounded preload, lazy images and version preservation passed");
