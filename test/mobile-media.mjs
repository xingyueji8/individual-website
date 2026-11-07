import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import { setInterval as nativeSetInterval, clearInterval as nativeClearInterval } from "node:timers";
import { parseHTML } from "linkedom";

// Exercise the actual Studio handlers with invented local photos and transports.
// This does not claim physical-device playback or mobile-network measurements.
const html = await readFile("public/studio.html", "utf8");
const window = parseHTML(html);
const { document, HTMLElement, HTMLSelectElement, HTMLInputElement } = window;
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
HTMLElement.prototype.focus = function () {};
window.setInterval = () => 0;
const alerts = [], network = [];
const context = vm.createContext({ window, document, Element: window.Element, Node: window.Node, Event: window.Event,
  console, URL, crypto: webcrypto, Response, File, Blob, FormData, TextEncoder, AbortController, performance,
  setTimeout, clearTimeout, navigator: { onLine: true, userAgent: "Android", deviceMemory: 4 },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { origin: "https://example.test", href: "https://example.test/studio" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  alert: message => alerts.push(message), confirm: () => true, prompt: () => null,
  IntersectionObserver: class { observe() {} unobserve() {} },
  Option: function (text, value) { const option = document.createElement("option"); option.textContent = text; option.value = value; return option; },
  fetch: async path => { network.push(path); throw new Error(`Unexpected request ${path}`); },
});
const run = source => vm.runInContext(source, context);
const node = id => document.getElementById(id);
for (const name of ["studio-upload", "studio-organize", "studio-share", "studio-background", "studio-rich-text"]) run(await readFile(`public/${name}.js`, "utf8"));
const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes("const app ="));
run(main.replace("checkSession();", ""));
run('app.sections=[{id:"photos",name:"Photos",kind:"gallery"}];refreshSectionOptions();enterSectionManager("gallery")');

let fileReads = 0;
const selected = Array.from({ length: 105 }, (_, i) => {
  const file = new File([`photo-${i}`], `${i}.jpg`, { type: "image/jpeg" });
  const read = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => { fileReads++; return read(); };
  return file;
});
context.selected = selected;
let yields = 0;
const ticker = nativeSetInterval(() => { yields++; }, 0);
await run("addSelectedPhotos(selected)"); nativeClearInterval(ticker);
assert.equal(run("photoSelection.length"), 100);
assert.equal(fileReads, 0, "choosing many photos does not read originals or compute hashes");
assert.equal(network.length, 0, "file selection does not depend on one request per photo");
assert.ok(yields >= 5, "the UI gets execution time while a large selection is added");
assert.equal(document.querySelectorAll(".photo-upload-preview").length, 100);
assert.ok([...document.querySelectorAll(".photo-upload-preview img")].every(image => !image.hasAttribute("src")));
run("for(const entry of [...photoSelection])removePhotoSelection(entry)");

// A provider-backed file is copied once. POST retries never re-read the provider.
const providerBytes = new Uint8Array([1, 2, 3, 4]);
context.provider = { name: "相册.JPG", type: "", size: 4, lastModified: 1, arrayBuffer: async () => providerBytes.buffer };
const snapshot = await run("snapshotUploadPhoto(provider)");
providerBytes.fill(9);
assert.equal(snapshot.file.type, "image/jpeg");
assert.deepEqual([...new Uint8Array(await snapshot.file.arrayBuffer())], [1, 2, 3, 4]);
assert.equal(snapshot.hash, createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex"));
context.badProvider = { name: "missing.jpg", size: 1, arrayBuffer: async () => { throw new DOMException("Provider unavailable", "NotReadableError"); } };
await assert.rejects(run("snapshotUploadPhoto(badProvider)"), error => error.code === "UPLOAD_FILE_READ" && error.retryable === false);
const readAbort = new AbortController(); context.readAbort = readAbort;
context.blockedProvider = { name: "cloud-photo.jpg", size: 1, arrayBuffer: () => new Promise(() => {}) };
const blockedRead = assert.rejects(run("snapshotUploadPhoto(blockedProvider,readAbort.signal)"), error => error.cancelled);
readAbort.abort(); await blockedRead;
let fileReadTimeout;
const readerFixture = vm.createContext({ setTimeout: callback => { fileReadTimeout = callback; return 1; }, clearTimeout() {},
  UploadCancelledError: class extends Error { constructor(message) { super(message); this.cancelled = true; } },
  FileReader: class { readAsArrayBuffer() {} abort() { this.onabort?.(); } } });
vm.runInContext(await readFile("public/studio-upload.js", "utf8"), readerFixture);
const readerTimeout = assert.rejects(vm.runInContext('readUploadPhotoBytes({name:"pending.jpg"})', readerFixture), error => error.code === "UPLOAD_FILE_READ" && !error.cancelled);
fileReadTimeout(); await readerTimeout;

// Stopping a batch aborts every live request, including a paused job, but leaves
// an already completed job alone. The checkpoint-preservation flag is explicit.
const batch = run("beginStudioUploadBatch()");
const completeJob = run('createUploadJob(new File(["done"],"done.bin"),"library")'); completeJob.finish("done");
const liveJob = run('createUploadJob(new File(["a"],"a.bin"),"library")');
const pausedJob = run('createUploadJob(new File(["b"],"b.bin"),"article")');
const liveRequest = liveJob.beginPartRequest();
pausedJob.element.querySelector("button").click();
const pausedWait = assert.rejects(pausedJob.waitUntilReady(), error => error.cancelled);
node("stop-all-uploads").click(); await pausedWait;
assert.equal(batch.signal.aborted, true);
assert.equal(liveRequest.signal.aborted, true);
assert.equal(liveJob.isCancelled(), true);
assert.equal(pausedJob.shouldPreserveCheckpoint(), true);
assert.equal(completeJob.isCancelled(), false);
liveJob.cancelled("stopped", { autoRemove: false }); pausedJob.cancelled("stopped", { autoRemove: false }); batch.finish();
assert.equal(node("stop-all-uploads").disabled, true);
assert.match(node("upload-stop-notice").textContent, /上传已停止/);

// A signalled abort must settle even if the browser emits no XHR abort event.
let sends = 0;
context.XMLHttpRequest = class {
  constructor() { this.upload = {}; }
  open() {} setRequestHeader() {} abort() {}
  send() { sends++; }
};
const alreadyAborted = new AbortController(); alreadyAborted.abort(); context.alreadyAborted = alreadyAborted;
await assert.rejects(run('uploadPartRequest("/upload",new Blob(["x"]),alreadyAborted)'), error => error.name === "AbortError");
assert.equal(sends, 0);
const abortController = new AbortController(); context.abortController = abortController;
const pendingRequest = run('uploadPartRequest("/upload",new Blob(["x"]),abortController)');
const rejectedRequest = assert.rejects(pendingRequest, error => error.name === "AbortError"); abortController.abort(); await rejectedRequest;

// A local file-read error is not retried six times as a network failure.
context.XMLHttpRequest = class {
  constructor() { this.upload = {}; }
  open() {} setRequestHeader() {} abort() {}
  send() { sends++; throw new DOMException("File vanished", "NotReadableError"); }
};
const brokenJob = run('createUploadJob(new File(["x"],"missing.jpg"),"photo")'); context.brokenJob = brokenJob;
const beforeSend = sends;
await assert.rejects(run('uploadPartWithRetry("/upload",new FormData(),brokenJob)'), error => error.code === "UPLOAD_FILE_READ");
assert.equal(sends - beforeSend, 1);
brokenJob.fail("expected test failure");

// The real photo loop stops before the next file. A successful first photo is
// retained and an interrupted photo receives a fresh token after cleanup.
const posts = [], deletions = [];
context.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.status = 200; }
  open(method, url) { assert.equal(method, "POST"); assert.equal(url, "/api/admin/media"); }
  setRequestHeader() {} getResponseHeader() { return null; }
  send(form) {
    posts.push(form);
    queueMicrotask(() => {
      if (posts.length === 2) { run("stopAllStudioUploads()"); return; }
      this.responseText = JSON.stringify({ id: "saved-photo" }); this.onload?.();
    });
  }
  abort() { this.onabort?.(); }
};
context.fetch = async (path, options = {}) => {
  if (path === "/api/admin/media/duplicates") return Response.json([{ duplicate: false }]);
  if (options.method === "DELETE") { deletions.push(path); return Response.json({ ok: true }); }
  throw new Error(`Unexpected photo request: ${path}`);
};
run('createCompressedPreview=async()=>new File(["preview"],"preview.webp",{type:"image/webp"});createPhotoMosaic=async()=>new Blob(["mosaic"],{type:"image/webp"});loadAlbumsAndMedia=async()=>{};loadSubsections=async()=>{};loadDashboard=async()=>{}');
context.batchPhotos = [new File(["one"], "one.jpg", { type: "" }), new File(["two"], "two.jpg", { type: "image/jpeg" }), new File(["three"], "three.jpg", { type: "image/jpeg" })];
await run("addSelectedPhotos(batchPhotos)");
const stoppedToken = run("photoSelection[1].token");
await run('submitPhotoUploads({preventDefault(){},currentTarget:document.getElementById("media-form")})');
assert.equal(posts.length, 2, "the third file is never sent after stop");
assert.equal(posts[0].get("file").type, "image/jpeg");
assert.equal(await posts[0].get("file").text(), "one", "the original bytes are not replaced by a thumbnail");
assert.equal(run("photoSelection.length"), 2);
assert.notEqual(run("photoSelection[0].token"), stoppedToken);
assert.ok(deletions[0].endsWith(stoppedToken));
assert.equal(run("photoSelection.every(entry=>!entry.preview&&!entry.mosaic&&!entry.uploadFile)"), true);
assert.match(node("media-notice").textContent, /已上传 1 张/);
assert.equal(run("app.activeUploadJobs.size"), 0);

// The original file/folder queue also stops; finishing file one cannot silently
// start file two once a global stop was requested.
let assetStarts = 0;
context.assetUploadStub = async () => { assetStarts++; run("stopAllStudioUploads()"); return "finished"; };
run("uploadAssetFile=assetUploadStub;loadAssets=async()=>{}");
await run('runAssetUpload([new File(["1"],"one.bin"),new File(["2"],"two.bin")],{visibility:"private"})');
assert.equal(assetStarts, 1);
assert.equal(run("studioUploadBatches.size"), 0);

// Worker processing keeps its large bitmap and canvas out of the UI thread,
// closes the bitmap, and independently builds the protected mosaic.
const canvases = []; let closed = 0, workerResult;
const worker = vm.createContext({ self: { postMessage: value => { workerResult = value; } },
  createImageBitmap: async () => ({ width: 8000, height: 6000, close() { closed++; } }),
  OffscreenCanvas: class {
    constructor(width, height) { this.width = width; this.height = height; canvases.push([width, height]); }
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob(["fixture"], { type: "image/webp" }); }
  } });
vm.runInContext(await readFile("public/photo-preparation-worker.js", "utf8"), worker);
await worker.self.onmessage({ data: { file: new Blob(["photo"]), thumbnail: false } });
assert.deepEqual(canvases, [[2560, 1920], [8, 8]]);
assert.equal(closed, 1);
assert.equal(workerResult.preview.type, "image/webp");
assert.equal(workerResult.mosaic.type, "image/webp");

// Device-aware video choice and actual dropped-frame monitoring: enough data
// can be buffered while the decoder is still dropping frames.
const videoWindow = parseHTML("<html><body><video src='/old.mp4'></video></body></html>");
let sample; const videoContext = vm.createContext({ navigator: { userAgent: "Android", deviceMemory: 4 }, document: videoWindow.document,
  matchMedia: () => ({ matches: false }), setInterval: callback => { sample = callback; return 1; }, clearInterval() {} });
vm.runInContext(await readFile("public/video-playback.js", "utf8"), videoContext);
const policy = videoContext.XYJVideo;
const variants = [360, 480, 720, 1080].map(height => ({ label: `${height}p`, url: `/${height}.mp4`, status: "ready" }));
assert.equal(policy.preferredVariant(variants).label, "720p");
videoContext.navigator.connection = { saveData: true };
assert.equal(policy.preferredVariant(variants).label, "480p");
videoContext.navigator.userAgent = "Desktop"; videoContext.navigator.deviceMemory = 16; videoContext.navigator.connection = {};
assert.equal(policy.preferredVariant(variants).label, "1080p");
const video = videoWindow.document.querySelector("video");
let frameData = { totalVideoFrames: 100, droppedVideoFrames: 0 }, drops = 0, pauses = 0, loads = 0;
Object.assign(video, { paused: false, seeking: false, readyState: 4, getVideoPlaybackQuality: () => frameData,
  pause: () => { pauses++; }, load: () => { loads++; } });
const cleanup = policy.watchFrameDrops(video, () => { drops++; });
video.dispatchEvent(new videoWindow.Event("playing")); sample();
frameData = { totalVideoFrames: 200, droppedVideoFrames: 30 }; sample();
assert.equal(drops, 1, "buffered-but-stuttering playback can request a lower rendition");
cleanup(); policy.disposeMedia(video);
assert.equal(video.hasAttribute("src"), false);
assert.equal(pauses, 1); assert.equal(loads, 1);
assert.deepEqual(alerts, []);
console.log("mobile media: lightweight photo selection, immutable originals, upload stop/retry, worker cleanup and video playback policy passed");
