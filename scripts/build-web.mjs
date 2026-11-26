import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "src/web");
const output = join(root, "dist/public");

// Keep the published names here. Refactoring a source folder does not change
// the URLs already used by browsers, shares, or installed copies of the PWA.
const pages = {
  home: "index.html",
  studio: "studio.html",
  account: "login.html",
  share: "share.html",
  "document-viewer": "document-viewer.html",
};
const stylesheets = {
  theme: "theme.css",
  "page-components": "vnext.css",
  glass: "material.css",
};

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return files.flat().sort();
}

async function pageHtml(page) {
  const directory = join(source, "pages", page);
  const template = await readFile(join(directory, "page.html"), "utf8");
  // Fragments occupy complete lines so the original script scope and CSS order
  // are preserved. Only one level of includes is allowed.
  const pattern = /^<!-- @include (shared:)?((?:[\w-]+\/)*[\w-]+\.(?:js|css)) -->\r?\n/gm;
  const fragments = await Promise.all([...template.matchAll(pattern)].map(([, shared, file]) =>
    readFile(join(shared ? join(source, "shared/fragments") : directory, file), "utf8")));
  let index = 0;
  const html = template.replace(pattern, () => fragments[index++]);
  if (html.includes("<!-- @include")) throw new Error(`Invalid include in ${page}/page.html`);
  return html;
}

export async function buildWeb() {
  const published = new Map();
  const add = (name, content) => {
    if (published.has(name)) throw new Error(`Two source files publish to /${name}`);
    published.set(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  };

  for (const [page, name] of Object.entries(pages)) add(name, await pageHtml(page));
  for (const [folder, name] of Object.entries(stylesheets)) {
    // The numbered filenames preserve the cascade inside each published CSS file.
    const files = await filesIn(join(source, "shared/styles", folder));
    add(name, Buffer.concat(await Promise.all(files.map(file => readFile(file)))));
  }
  for (const name of ["features", "shared/appearance", "shared/languages", "pwa", "hosting", "icons", "vendor", "assets"]) {
    for (const file of await filesIn(join(source, name))) {
      const filename = basename(file);
      add(name === "assets" ? `assets/${filename}` : filename, await readFile(file));
    }
  }

  // This pinned library is copied unmodified so photo uploads can decode HEIC.
  const heic = join(root, "node_modules/heic-to");
  add("vendor/heic-to.js", await readFile(join(heic, "dist/csp/heic-to.min.js")));
  add("vendor/heic-to.LICENSE", await readFile(join(heic, "LICENSE")));
  add("vendor/heic-to.SOURCE.txt", "heic-to 1.5.2 (LGPL-3.0)\nhttps://github.com/hoppergee/heic-to/tree/v1.5.2\nUses libheif and libde265; source and rebuild instructions: https://github.com/hoppergee/heic-to\nThe CSP build is distributed unmodified.\n");

  await mkdir(output, { recursive: true });
  await Promise.all([...published].map(async ([name, bytes]) => {
    const path = join(output, name);
    const current = await readFile(path).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (current?.equals(bytes)) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }));
  const outputFiles = new Set([...published.keys()].map(name => join(output, name)));
  for (const file of await filesIn(output)) {
    if (!outputFiles.has(file)) await rm(file);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWeb();
  console.log("Built site into dist/public/");
}
