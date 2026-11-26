import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const assets = new URL("../../dist/public/", import.meta.url);
const read = path => readFile(new URL(path, assets), "utf8");
const origin = "https://xingyueji.com.cn";

async function checkLocalAsset(path, from) {
  if (!path) return;
  const url = new URL(path, origin);
  if (url.origin !== origin) return; // CDN or external link
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  assert.ok((await stat(new URL(file, assets))).isFile(), `${from}: missing ${url.pathname}`);
}

const pages = ["index.html", "studio.html", "login.html", "share.html", "document-viewer.html"];
for (const name of pages) {
  const html = await read(name);
  assert.ok(!html.includes("<!-- @include"), `${name}: include left in output`);
  const { document } = parseHTML(html);
  for (const script of document.querySelectorAll("script")) {
    if (script.hasAttribute("src")) await checkLocalAsset(script.getAttribute("src"), name);
    else new vm.Script(script.textContent, { filename: name });
  }
  for (const el of document.querySelectorAll('link[rel="stylesheet"], link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"]')) {
    await checkLocalAsset(el.getAttribute("href"), name);
  }
  for (const el of document.querySelectorAll("img[src]")) await checkLocalAsset(el.getAttribute("src"), name);
}

const manifest = JSON.parse(await read("manifest.webmanifest"));
for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap(shortcut => shortcut.icons || [])]) {
  await checkLocalAsset(icon.src, "PWA manifest");
}
const handlers = new Map();
let install;
vm.runInNewContext(await read("sw.js"), {
  self: { location: { origin }, addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting() {} },
  caches: { open: async () => ({ addAll: paths => Promise.all(paths.map(path => checkLocalAsset(path, "PWA offline shell"))) }) },
  URL,
});
handlers.get("install")({ waitUntil(promise) { install = promise; } });
await install;

for (const file of ["vendor/heic-to.js","vendor/heic-to.LICENSE","vendor/heic-to.SOURCE.txt","pdf-engine.js","html2pdf.LICENSE","photo-preparation-worker.js","_headers"]) {
  await checkLocalAsset("/" + file, "generated assets");
}
await assert.rejects(stat(new URL("pdf-render-check.html", assets)), { code: "ENOENT" });

console.log("Published pages, browser dependencies, PWA offline shell and vendor files are complete");
