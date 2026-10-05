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
    media.src = asset.url; if (asset.kind === "video" && asset.poster_url) media.poster = asset.poster_url; box.append(media);
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
    dialog.addEventListener("close", () => body.replaceChildren());
  }
  const body = dialog.querySelector(".editor-preview-body"); body.textContent = "正在准备预览…";
  if (!dialog.open) dialog.showModal();
  // Sanitize on the server just as saving does, while leaving the draft and
  // its attachment tracking entirely untouched.
  try {
    const snapshot = { html: editor.innerHTML, id: document.getElementById("content-id").value,
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
