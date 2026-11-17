import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
const { document } = parseHTML("<html><body></body></html>");
const captures = [], canvases = [];
let blank = false, failAt = -1;
const size = { unit: "mm", k: 72 / 25.4, inner: { width: 186, height: 271, px: { width: 703, height: 1024 } } };
function engine() {
  const prop = {}, opt = { margin: [12, 12, 14, 12] };
  const worker = {
    prop, opt,
    set(values) { for (const [key, value] of Object.entries(values)) (['pdf','container','overlay'].includes(key) ? prop : opt)[key] = value; return this; },
    from(source) { prop.source = source; return this; },
    toContainer() {
      prop.overlay = document.createElement("div"); prop.container = document.createElement("article");
      prop.container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 703, height: 82000 });
      Object.defineProperty(prop.container, "scrollHeight", { value: 82000 });
      prop.overlay.append(prop.container); document.body.append(prop.overlay); return this;
    },
    toCanvas() {
      assert.equal(prop.overlay.isConnected, true);
      if (captures.length === failAt) throw new Error("render failed");
      captures.push({ y: opt.html2canvas.y, height: opt.html2canvas.height });
      prop.canvas = { width: 1406, height: opt.html2canvas.height * 2,
        getContext: () => ({ getImageData: () => ({ data: blank ? new Uint8ClampedArray([255,255,255,255]) : new Uint8ClampedArray([20,90,160,255]) }) }) };
      canvases.push(prop.canvas); prop.overlay.remove(); return this;
    },
    toPdf() {
      assert.ok(prop.source.height <= 2048 && prop.source.width <= 1406);
      prop.pdf ||= { pages: 1, internal: { getNumberOfPages() { return prop.pdf.pages; } }, addPage() { this.pages++; }, setPage() {}, link() {} };
      return this;
    },
    get(key) { return Promise.resolve(key === "pageSize" ? size : prop[key]); },
  };
  return worker;
}
const context = vm.createContext({ document, console, setTimeout, clearTimeout, AbortController, html2pdf: engine });
vm.runInContext(await readFile("public/article-pdf.js", "utf8"), context);
const render = vm.runInContext("XYJArticlePdf.render", context);
const root = document.createElement("article"); root.innerHTML = '<img src="data:image/png;base64,eA==">'; document.body.append(root);
const options = { html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
const pdf = await render(root, options);
assert.equal(pdf.pages, Math.ceil(82000 / 1024));
assert.equal(captures.length, pdf.pages);
assert.ok(captures.every((item, i) => item.y === i * 1024 && item.height <= 1024));
assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), "release each page bitmap before continuing");
assert.equal(document.body.children.length, 1, "remove rendering overlays");
blank = true;
await assert.rejects(render(root, options), /渲染结果为空/);
assert.equal(document.body.children.length, 1);
blank = false; failAt = captures.length + 1;
await assert.rejects(render(root, options), /render failed/);
assert.equal(document.body.children.length, 1, "a rendering failure must not leave an invisible overlay blocking the page");
console.log("bounded PDF page canvases, long articles, blank-output rejection, bitmap release and failure cleanup passed");
