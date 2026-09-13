import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const studioHtml = await readFile(new URL("../public/studio.html", import.meta.url), "utf8");
const photoScript = await readFile(new URL("../public/studio-organize.js", import.meta.url), "utf8");
const navigationCss = await readFile(new URL("../public/studio-navigation.css", import.meta.url), "utf8");
new Function(photoScript);
const inlineScripts = [...studioHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "Studio must contain inline application JavaScript");
for (const source of inlineScripts) new Function(source);

assert.match(studioHtml, /id="subsection-download-policy"/);
assert.match(studioHtml, /data-view="site-content">网站内容/);
assert.doesNotMatch(studioHtml, /data-view="sections">大板块与小板块/);
assert.match(studioHtml, /id="view-site-content"/);
assert.match(studioHtml, /id="studio-back-button"/);
assert.match(studioHtml, /id="content-structure-nav"/);
assert.match(studioHtml, /id="studio-primary-nav"/);
assert.match(studioHtml, /id="studio-content-navigation"/);
assert.match(studioHtml, /id="content-inline-editor-host"/);
assert.match(studioHtml, /function initializeEmbeddedContentEditors/);
assert.match(studioHtml, /function syncInlineContentSelection/);
assert.match(studioHtml, /classList\.toggle\("content-mode",name==="sections"\)/);
assert.match(studioHtml, /initializeEmbeddedContentEditors\(\);initializeStudioSafetyNavigation/);
assert.doesNotMatch(studioHtml, /id="content-manager-open"/);
assert.doesNotMatch(studioHtml, /id="studio-back-button"[^>]*>← 返回</);
assert.match(navigationCss, /\.studio-back-button \{[\s\S]*background:transparent !important/);
assert.match(navigationCss, /\.content-manager-layout \{[^}]*grid-template-columns:minmax\(285px,\.58fr\) minmax\(0,1\.42fr\)/);
assert.match(navigationCss, /\.side-content-navigation \.content-structure-nav button\.active/);
assert.match(studioHtml, /function confirmStudioNavigation/);
assert.match(navigationCss, /\.content-structure-nav button\.active[\s\S]*color:#102e38 !important/);
assert.match(studioHtml, /站长私有备注（仅后台可见）/);
assert.match(studioHtml, /className="upload-job-rate"/);
assert.match(studioHtml, /function uploadPartRequest\(/);
assert.match(studioHtml, /UPLOAD_STALL_TIMEOUT_MS=30\*1000/);
assert.match(studioHtml, /waitUntilReady/);
assert.match(studioHtml, /wasNetworkAbort/);
assert.match(studioHtml, /照片权限已保存/);
assert.match(studioHtml, /选择原文件继续/);
assert.match(studioHtml, /刷新后待续传/);
assert.match(studioHtml, /取消并删除/);
assert.match(studioHtml, /hardwareConcurrency/);
assert.match(studioHtml, /activeLoaded/);
assert.match(studioHtml, /pause\.hidden=true/);
assert.match(studioHtml, /setTimeout\(\(\)=>job\.remove\(\),600\)/);
assert.match(studioHtml, /finish\(text\)\{[^}]*job\.remove\(\)/);
assert.match(studioHtml, /上传到图片小板块/);
assert.match(photoScript, /form\.append\("subsectionId", subsectionId\)/);
assert.match(photoScript, /refreshMediaSubsectionOptions\(sectionId, subsectionId\)/);
assert.match(studioHtml, /id="media-file"[^>]*multiple/);
assert.match(studioHtml, /id="photo-selection-previews"/);
assert.match(studioHtml, /id="photo-upload-queue"/);
assert.match(photoScript, /uploadPartWithRetry\("\/api\/admin\/media"/);
assert.match(photoScript, /entry\.allowDuplicate/);
assert.match(studioHtml, /uploadTarget\.value=event\.target\.value/);
for (const field of ["section-description", "subsection-description"]) {
  const input = studioHtml.match(new RegExp(`<input[^>]*id="${field}"[^>]*>`))?.[0];
  assert.ok(input, `${field} must remain editable`);
  assert.doesNotMatch(input, /\brequired\b/, `${field} must be optional`);
  assert.match(input, /placeholder="可留空"/);
  assert.match(studioHtml, new RegExp(`<label for="${field}">[^<]*选填[^<]*</label>`));
}
assert.match(studioHtml, /prompt\("小板块说明（选填，可留空）"\)/);

console.log("studio UI regression passed");
