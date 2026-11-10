function setStudioPresentation(prefix, item = {}) {
  document.getElementById(`${prefix}-article-layout`).value = item.article_layout || (prefix === "section" ? "article" : "inherit");
  document.getElementById(`${prefix}-gallery-layout`).value = item.gallery_layout || (prefix === "section" ? "grid" : "inherit");
  syncStudioPresentationFields();
}
function studioPresentationPayload(prefix) {
  return { articleLayout: document.getElementById(`${prefix}-article-layout`).value,
    galleryLayout: document.getElementById(`${prefix}-gallery-layout`).value };
}
function syncStudioPresentationFields() {
  const parent = app.sections.find(item => item.id === document.getElementById("subsection-section").value);
  document.querySelectorAll("[data-presentation-kind]").forEach(node => {
    const kind = node.dataset.presentationPrefix === "section" ? document.getElementById("section-kind").value : parent?.kind;
    node.hidden = node.dataset.presentationKind !== kind;
  });
}
function rememberStudioEditorSelection() {
  const editor = document.getElementById("content-editor");
  const selection = getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) app.editorRange = selection.getRangeAt(0).cloneRange();
}
const studioArticleImages = { session: 0, coverBusy: false, inlineBusy: false, uploaded: new Set() };
function resetStudioArticleImages() {
  studioArticleImages.session += 1; studioArticleImages.uploaded.clear(); app.editorRange = null;
  document.getElementById("content-cover-notice").textContent = "";
  document.querySelectorAll(".article-image-drop").forEach(node => node.classList.remove("is-dragging"));
}
function studioArticleImageElement(item, file) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id || "")) throw new Error("上传返回的图片信息不完整，请重试。");
  const image = document.createElement("img"); image.dataset.studioMediaId = item.id;
  image.src = `/api/admin/media/${item.id}/source?preview=1`;
  image.alt = file.name; image.loading = "lazy"; return image;
}
function studioArticleBodyHtml() {
  const copy = document.getElementById("content-editor").cloneNode(true);
  copy.querySelectorAll("img[data-studio-media-id]").forEach(image => {
    const id = image.dataset.studioMediaId;
    if (/^[a-zA-Z0-9_-]{1,80}$/.test(id || "")) image.setAttribute("src", `/media/${id}?preview=1`);
    image.removeAttribute("data-studio-media-id");
  });
  return copy.innerHTML;
}
function hydrateStudioArticleImages() {
  document.querySelectorAll("#content-editor img[src]").forEach(image => {
    let url; try { url = new URL(image.getAttribute("src"), location.href); } catch { return; }
    const id = url.origin === location.origin && url.pathname.match(/^\/media\/([a-zA-Z0-9_-]{1,80})$/)?.[1];
    if (id) { image.dataset.studioMediaId = id; image.src = `/api/admin/media/${id}/source?preview=1`; }
  });
}
function studioArticleImageContext() {
  return { session: studioArticleImages.session, articleId: document.getElementById("content-id").value,
    visibility: document.getElementById("content-visibility").value, allowedUserIds: [...selectedAudienceIds("content-user-picker")],
    range: app.editorRange?.cloneRange() || null };
}
function studioArticleImageContextActive(context) {
  return context.session === studioArticleImages.session && context.articleId === document.getElementById("content-id").value;
}
function setStudioArticleCover(item) {
  const select = document.getElementById("content-cover");
  if (![...select.options].some(option => option.value === item.id)) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = item.caption || item.filename || "本地上传的封面"; select.append(option);
  }
  select.value = item.id; updateCoverPreview(); markStudioDirty(document.getElementById("content-form"));
}
async function uploadStudioArticleImages(files, role = "inline", context = studioArticleImageContext()) {
  const notice = document.getElementById(role === "cover" ? "content-cover-notice" : "content-notice");
  const busy = role === "cover" ? "coverBusy" : "inlineBusy";
  if (studioArticleImages[busy]) { notice.textContent = "图片正在上传，请稍后再添加。"; return; }
  const supplied = [...files]; if (!supplied.length) return;
  if (role === "cover" && supplied.length !== 1) { notice.textContent = "封面一次只能选择一张图片。"; return; }
  if (supplied.length > 100) { notice.textContent = "一次最多插入 100 张图片，请分批添加。"; return; }
  const accepted = [], failures = [];
  for (const file of supplied) {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"].includes(photoMimeType(file).toLowerCase())) failures.push(`${file.name}：不支持的图片格式`);
    else if (!file.size || file.size > 20 * 1024 * 1024) failures.push(`${file.name}：图片须为非空文件且不超过 20MB`);
    else accepted.push(file);
  }
  if (!accepted.length) { notice.textContent = failures.join("；"); return; }
  const batch = beginStudioUploadBatch(); let completed = 0, range = context.range;
  studioArticleImages[busy] = true;
  document.querySelector('#content-form button[type="submit"]').disabled = true;
  const zone = document.getElementById(role === "cover" ? "content-cover-preview" : "content-editor"); zone.setAttribute("aria-busy", "true");
  if (role === "cover") for (const id of ["content-cover-upload", "content-cover-clear", "content-cover"]) document.getElementById(id).disabled = true;
  try {
    for (const file of accepted) {
      if (batch.signal.aborted || !studioArticleImageContextActive(context)) break;
      notice.textContent = `正在上传${role === "cover" ? "封面" : "插图"} ${completed + 1}/${accepted.length}…`;
      try {
        const item = await uploadInline(file, { signal: batch.signal, context, requiredPreview: true });
        if (batch.signal.aborted || !studioArticleImageContextActive(context)) break;
        if (role === "cover") setStudioArticleCover(item);
        else range = insertInlineImageAtEditorRange(item, file, { range });
        completed += 1;
      } catch (error) { if (error.cancelled) break; failures.push(`${file.name}：${error.message}`); }
    }
    if (studioArticleImageContextActive(context)) notice.textContent = `${batch.signal.aborted ? "上传已停止；" : ""}${role === "cover" ? `已设置 ${completed} 张封面` : `已插入 ${completed}/${accepted.length} 张图片`}${failures.length ? `；${failures.join("；")}` : ""}${completed ? "。请保存文章使修改生效。" : "。原有图片保持不变。"}`;
  } finally {
    studioArticleImages[busy] = false; zone.removeAttribute("aria-busy"); batch.finish();
    document.querySelector('#content-form button[type="submit"]').disabled = studioArticleImages.coverBusy || studioArticleImages.inlineBusy;
    if (role === "cover") for (const id of ["content-cover-upload", "content-cover-clear", "content-cover"]) document.getElementById(id).disabled = false;
  }
}
function studioImageDragHasFiles(event) {
  return Boolean(event.dataTransfer?.files?.length || [...(event.dataTransfer?.types || [])].includes("Files"));
}
function rememberStudioImageDropPosition(event) {
  const editor = document.getElementById("content-editor"); let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(event.clientX, event.clientY);
  else if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (position && editor.contains(position.offsetNode)) { range = document.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); }
  }
  if (range && editor.contains(range.commonAncestorContainer)) app.editorRange = range.cloneRange();
  else rememberStudioEditorSelection();
}
function initializeStudioArticleImages() {
  const coverInput = document.getElementById("content-cover-file"), inlineInput = document.getElementById("inline-image-input");
  const cover = document.getElementById("content-cover-preview"), editor = document.getElementById("content-editor");
  const chooseCover = () => { if (!studioArticleImages.coverBusy) coverInput.click(); };
  document.getElementById("content-cover-upload").addEventListener("click", chooseCover);
  cover.addEventListener("click", chooseCover);
  cover.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseCover(); } });
  document.getElementById("content-cover-clear").addEventListener("click", () => {
    document.getElementById("content-cover").value = ""; updateCoverPreview(); markStudioDirty(document.getElementById("content-form"));
  });
  coverInput.addEventListener("change", event => { const files = [...event.target.files]; event.target.value = ""; uploadStudioArticleImages(files, "cover"); });
  document.getElementById("insert-image").addEventListener("click", () => { rememberStudioEditorSelection(); inlineInput.click(); });
  inlineInput.addEventListener("change", event => { const files = [...event.target.files]; event.target.value = ""; uploadStudioArticleImages(files); });
  for (const [zone, role] of [[cover, "cover"], [editor, "inline"]]) {
    zone.addEventListener("dragover", event => { if (studioImageDragHasFiles(event)) { event.preventDefault(); event.stopPropagation(); zone.classList.add("is-dragging"); event.dataTransfer.dropEffect = "copy"; } });
    zone.addEventListener("dragleave", event => { if (!event.relatedTarget || !zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging"); });
    zone.addEventListener("drop", event => {
      // Do not let a browser navigate away or insert a local file:// URL.
      event.preventDefault(); event.stopPropagation(); zone.classList.remove("is-dragging");
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) { document.getElementById(role === "cover" ? "content-cover-notice" : "content-notice").textContent = "请从本机拖入图片文件；网页中的图片请先保存到本机。"; return; }
      if (role === "inline") rememberStudioImageDropPosition(event);
      uploadStudioArticleImages(files, role);
    });
  }
  editor.addEventListener("paste", event => {
    const files = [...(event.clipboardData?.files || [])]; if (!files.length) return;
    event.preventDefault(); rememberStudioEditorSelection(); uploadStudioArticleImages(files);
  });
  document.addEventListener("dragover", event => { if (studioImageDragHasFiles(event)) event.preventDefault(); });
  document.addEventListener("drop", event => {
    if (!studioImageDragHasFiles(event)) return;
    event.preventDefault(); document.querySelectorAll(".article-image-drop").forEach(node => node.classList.remove("is-dragging"));
    if (!document.getElementById("content-form").hidden) document.getElementById("content-notice").textContent = "请把图片拖入封面区域或正文编辑框。";
  });
}
function restoreStudioEditorSelection() {
  const editor = document.getElementById("content-editor"); const selection = getSelection();
  const saved = app.editorRange;
  editor.focus({ preventScroll: true });
  let range = saved?.cloneRange();
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  }
  selection.removeAllRanges(); selection.addRange(range);
}
function normalizeStudioFontSize(size = app.editorFontSize || "16") {
  document.querySelectorAll('#content-editor font[size="7"]').forEach(font => {
    const span = document.createElement("span"); span.style.cssText = font.getAttribute("style") || "";
    span.style.fontSize = `${size}px`;
    if (font.getAttribute("face")) span.style.fontFamily = font.getAttribute("face");
    if (font.getAttribute("color")) span.style.color = font.getAttribute("color");
    while (font.firstChild) span.append(font.firstChild); font.replaceWith(span);
  });
  document.querySelectorAll("#content-editor span[style]").forEach(span => {
    if (span.style.fontSize === "xxx-large") span.style.fontSize = `${size}px`;
  });
}
function applyStudioEditorCommand(command, value = null) {
  restoreStudioEditorSelection();
  document.execCommand("styleWithCSS", false, command !== "fontSize");
  document.execCommand(command, false, command === "fontSize" ? "7" : value);
  if (command === "fontSize") { app.editorFontSize = String(value); normalizeStudioFontSize(value); }
  document.execCommand("styleWithCSS", false, true);
  rememberStudioEditorSelection();
  document.getElementById("content-editor").dispatchEvent(new Event("input", { bubbles: true }));
}
function studioPreviewAsset(asset) {
  const box = document.createElement("section"); box.className = "editor-preview-asset";
  const title = document.createElement("h3"); title.textContent = asset.display_name || asset.filename; box.append(title);
  if (asset.kind === "video" || asset.kind === "audio") {
    const media = document.createElement(asset.kind); media.controls = true; media.preload = "metadata";
    if (asset.kind === "video") media.playsInline = true;
    media.src = asset.kind === "video" ? globalThis.XYJVideo?.preferredVariant(asset.variants)?.url || asset.url : asset.url;
    if (asset.kind === "video" && asset.poster_url) media.poster = asset.poster_url; box.append(media);
  } else if (asset.kind === "pdf" || asset.kind === "word") {
    const frame = document.createElement("iframe"); frame.title = title.textContent;
    frame.src = asset.kind === "pdf" ? asset.url : asset.variants?.find(item => item.label === "preview")?.url || `/document-viewer.html?asset=${encodeURIComponent(asset.id)}&studio=1`;
    box.append(frame);
  } else {
    const link = document.createElement("a"); link.href = asset.downloadUrl || asset.url; link.textContent = "下载附件";
    link.target = "_blank"; link.rel = "noopener noreferrer"; box.append(link);
  }
  return box;
}
let studioPreviewGeneration = 0;
async function previewStudioContent() {
  const generation = ++studioPreviewGeneration;
  const editor = document.getElementById("content-editor");
  let dialog = document.getElementById("editor-preview-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog"); dialog.id = "editor-preview-dialog"; dialog.className = "editor-preview-dialog";
    dialog.setAttribute("aria-labelledby", "editor-preview-title");
    const head = document.createElement("header"); head.className = "editor-preview-head";
    const title = document.createElement("h2"); title.id = "editor-preview-title"; title.textContent = "正文预览";
    const close = document.createElement("button"); close.type = "button"; close.className = "btn small ghost"; close.textContent = "关闭预览"; close.addEventListener("click", () => dialog.close());
    head.append(title, close);
    const body = document.createElement("article"); body.className = "editor-preview-body reader-body";
    dialog.append(head, body); document.body.append(dialog);
    dialog.addEventListener("close", () => { body.querySelectorAll("video,audio").forEach(media => globalThis.XYJVideo?.disposeMedia(media)); body.replaceChildren(); });
  }
  const body = dialog.querySelector(".editor-preview-body");
  body.querySelectorAll("video,audio").forEach(media => globalThis.XYJVideo?.disposeMedia(media)); body.textContent = "正在准备预览…";
  if (!dialog.open) dialog.showModal();
  // Sanitize on the server just as saving does, while leaving the draft and
  // its attachment tracking entirely untouched.
  try {
    const snapshot = { html: studioArticleBodyHtml(), id: document.getElementById("content-id").value,
      title: document.getElementById("content-title").value || "未命名内容",
      sectionId: document.getElementById("content-section").value,
      subsectionId: document.getElementById("content-subsection").value };
    const data = await api("/api/admin/content-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bodyHtml: snapshot.html }) });
    if (!dialog.open || generation !== studioPreviewGeneration) return;
    const template = document.createElement("template"); template.innerHTML = data.body_html;
    template.content.querySelectorAll("img").forEach(image => {
      const url = new URL(image.getAttribute("src") || "", location.href);
      const id = url.origin === location.origin ? url.pathname.match(/^\/media\/([a-zA-Z0-9_-]{1,80})$/)?.[1] : null;
      if (id) image.src = `/api/admin/media/${id}/source?preview=1`;
      image.loading = "lazy";
    });
    template.content.querySelectorAll(".resource-embed").forEach(placeholder => {
      const asset = app.assets.find(item => item.id === placeholder.dataset.resourceId && item.content_id === snapshot.id && item.status === "ready");
      if (asset) placeholder.replaceWith(studioPreviewAsset(asset));
      else { const message = document.createElement("p"); message.textContent = "此附件已删除或不属于当前文章。"; placeholder.replaceWith(message); }
    });
    body.replaceChildren();
    const section = app.sections.find(item => item.id === snapshot.sectionId);
    let current = app.subsections.find(item => item.id === snapshot.subsectionId); let layout = section?.article_layout || "article";
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.article_layout && current.article_layout !== "inherit") { layout = current.article_layout; break; }
      current = app.subsections.find(item => item.id === current.parent_id);
    }
    if (layout === "feed") {
      const entry = app.content.find(item => item.id === snapshot.id);
      const date = document.createElement("time"); date.className = "ps-feed-date";
      date.textContent = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(entry?.published_at || Date.now()));
      body.append(date, document.createElement("hr"));
    }
    const title = document.createElement("h1"); title.textContent = snapshot.title; body.append(title, template.content);
    dialog.scrollTop = 0;
  } catch (error) { if (dialog.open && generation === studioPreviewGeneration) body.textContent = error.message; }
}
function initializeStudioRichText() {
  initializeStudioArticleImages();
  const toolbar = document.querySelector("#content-form .toolbar");
  toolbar.addEventListener("pointerdown", rememberStudioEditorSelection);
  toolbar.addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
  document.addEventListener("selectionchange", rememberStudioEditorSelection);
  document.getElementById("content-editor").addEventListener("input", () => normalizeStudioFontSize());
  document.getElementById("editor-font-family").addEventListener("change", event => applyStudioEditorCommand("fontName", event.target.value));
  document.getElementById("editor-font-size").addEventListener("change", event => applyStudioEditorCommand("fontSize", event.target.value));
  document.getElementById("editor-text-color").addEventListener("input", event => applyStudioEditorCommand("foreColor", event.target.value));
  document.getElementById("preview-content").addEventListener("click", previewStudioContent);
  document.getElementById("section-kind").addEventListener("change", syncStudioPresentationFields);
  document.getElementById("subsection-section").addEventListener("change", syncStudioPresentationFields);
}
