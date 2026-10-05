/* Manual browser fixture with the real Worker, isolated D1/R2 and invented
 * content. No production accounts, database or objects are touched. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Miniflare } from "miniflare";

const mf = new Miniflare({ modules: true, cf: false, scriptPath: "src/worker.js", compatibilityDate: "2026-08-06", d1Databases: ["DB"], r2Buckets: ["BUCKET"],
  bindings: { ADMIN_PASSWORD: "space-fixture-password", SESSION_SECRET: "space-fixture-secret-at-least-32-bytes" } });
const base = "http://localhost"; let identity = "";
async function api(path, body, method = body ? "POST" : "GET") {
  const response = await mf.dispatchFetch(base + path, { method, headers: { Cookie: identity, "Content-Type": "application/json", "User-Agent": "manual-space-fixture" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return { data, response };
}
await api("/api/guest/config");
const login = await api("/api/admin/login", { password: "space-fixture-password" });
identity = login.response.headers.getSetCookie()[0].split(";")[0];
const user = (await api("/api/auth/register", { username: "space_fixture", nickname: "预览账号", password: "Preview123456", displayName: "预览账号", contactType: "email", contact: "preview@example.test" })).data;
await api(`/api/admin/users/${user.user.id}`, { status: "approved" }, "PUT");
const signed = await api("/api/auth/login", { username: "space_fixture", password: "Preview123456" });
identity += "; " + signed.response.headers.getSetCookie().find(value => value.startsWith("xyj_user=")).split(";")[0];
await api("/api/admin/sections/section-essays", { name: "随笔", kind: "content", visibility: "public", articleLayout: "feed", showAll: true, description: "生活、思考和一路走来的小事。\n在日常中留下自己的记录。" }, "PUT");
await api("/api/admin/sections/section-photos", { name: "影像", kind: "gallery", visibility: "public", galleryLayout: "masonry", showAll: true, description: "用照片记录眼前的风景。" }, "PUT");
const diary = (await api("/api/admin/subsections", { sectionId: "section-essays", name: "日常", description: "最近发生的事，和偶尔冒出来的想法。", visibility: "public" })).data;
const trips = (await api("/api/admin/subsections", { sectionId: "section-essays", name: "城市散步", description: "换一个角度，重新认识熟悉的街道。", visibility: "public" })).data;
const autumn = (await api("/api/admin/subsections", { sectionId: "section-essays", parentId: trips.id, name: "秋天", description: "记下秋日出行的片段。", visibility: "public" })).data;
const portrait = await readFile("public/assets/avatar-glass.png");
const compressed = execFileSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "scale=480:-1", "-c:v", "libwebp", "-f", "image2pipe", "pipe:1"], { input: portrait, maxBuffer: 2 * 1024 * 1024 });
const photoForm = new FormData(); photoForm.append("file", new File([portrait], "sample.png", { type: "image/png" })); photoForm.append("preview", new File([compressed], "sample-preview.webp", { type: "image/webp" })); photoForm.append("sectionId", "section-photos"); photoForm.append("caption", "预览示例");
const photoRequest = new Request(base + "/api/admin/media", { method: "POST", headers: { Cookie: identity, "User-Agent": "manual-space-fixture" }, body: photoForm });
const photoResponse = await mf.dispatchFetch(photoRequest.url, { method: "POST", headers: photoRequest.headers, body: await photoRequest.arrayBuffer() });
const photo = await photoResponse.json(); if (!photoResponse.ok) throw new Error(JSON.stringify(photo));
const bodies = [
  ['给日常留一点空白', diary.id, '<p>今天没有特别的安排，沿着河边慢慢走了很久。</p><p>把<span style="color:#b44054;font-size:24px;font-family:KaiTi;text-decoration:underline">一点小小的发现</span>写下来，就成了新的记忆。</p>'],
  ['周末的一段散步', diary.id, `<p>遇见新的风景，也给自己一个停下来的理由。</p><img src="/media/${photo.id}?preview=1" alt="散步的照片">`],
  ['秋日片段', autumn.id, '<p><strong>风终于凉了下来。</strong>从街角的小店出来，天色也变得柔和。</p>'],
];
const entries = [];
for (const [title, subsectionId, bodyHtml] of bodies) entries.push((await api("/api/admin/content", { title, sectionId: "section-essays", subsectionId, bodyHtml, visibility: "public", status: "published", excerpt: "本条内容用于检查个人空间布局。" })).data);
const db = await mf.getD1Database("DB");
for (let i = 0; i < entries.length; i++) await db.prepare("UPDATE content SET published_at=? WHERE id=?").bind(`2026-10-0${3-i}T08:00:00.000Z`, entries[i].id).run();
const bucket = await mf.getR2Bucket("BUCKET");
let video = null;
try { video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x8caaa7:s=480x270:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 2 * 1024 * 1024 }); } catch { /* Video is optional on machines without ffmpeg. */ }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 44>>stream\nBT /F1 18 Tf 30 100 Td (Preview PDF) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
for (const [id, name, kind, mime, data] of [["preview-pdf", "示例文档.pdf", "pdf", "application/pdf", pdf], ...(video ? [["preview-video", "散步片段.mp4", "video", "video/mp4", video]] : [])]) {
  await bucket.put(`fixture/${id}`, data, { httpMetadata: { contentType: mime } });
  await db.prepare(`INSERT INTO assets(id,object_key,filename,display_name,mime_type,size_bytes,kind,visibility,access_mode,scope,section_id,subsection_id,content_id,status,download_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'public','public','article','section-essays',?,?,'ready','public',?,?)`).bind(id, `fixture/${id}`, name, name, mime, data.length, kind, diary.id, entries[0].id, new Date().toISOString(), new Date().toISOString()).run();
}
const article = (await api(`/api/admin/content/${entries[0].id}`)).data;
await api(`/api/admin/content/${article.id}`, { sectionId: article.section_id, subsectionId: article.subsection_id, title: article.title, bodyHtml: article.body_html + '<div class="resource-embed" data-resource-type="asset" data-resource-id="preview-pdf">文档</div>' + (video ? '<div class="resource-embed" data-resource-type="asset" data-resource-id="preview-video">视频</div>' : ''), visibility: "public", status: "published" }, "PUT");
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (/^\/(api|media|files)\//.test(url.pathname)) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers(request.headers); headers.set("Cookie", identity); if (headers.has("Origin")) headers.set("Origin", base);
      const workerResponse = await mf.dispatchFetch(base + url.pathname + url.search, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      response.writeHead(workerResponse.status, Object.fromEntries([...workerResponse.headers].filter(([name]) => name !== "set-cookie")));
      response.end(Buffer.from(await workerResponse.arrayBuffer())); return;
    }
    const path = url.pathname === "/" ? "index.html" : url.pathname === "/studio" ? "studio.html" : url.pathname.slice(1);
    if (path.includes("..")) { response.writeHead(403).end(); return; }
    const data = await readFile("public/" + path); const extension = path.slice(path.lastIndexOf("."));
    response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream", "Cache-Control": "no-store" }); response.end(data);
  } catch (error) { response.writeHead(500, { "Content-Type": "text/plain" }); response.end(String(error)); }
});
server.listen(Number(process.env.XYJ_VISUAL_TEST_PORT || 4173), "0.0.0.0", () => console.log("Isolated personal space preview: http://127.0.0.1:4173"));
process.on("SIGTERM", async () => { server.close(); await mf.dispose(); process.exit(); });
