async function loadContent() {
  app.content = await api("/api/admin/content");
  renderContentList();
  refreshCoverOptions();
}
function renderContentList() {
  renderStudioArticleList();
}
function updateCoverPreview() {
  const host = document.getElementById("content-cover-preview");
  const id = document.getElementById("content-cover").value;
  const item = app.media.find((media) => media.id === id);
  clear(host);
  if (!item) {
    const span = document.createElement("span");
    span.textContent = "点击选择本地图片，或将图片拖到这里";
    host.append(span);
    return;
  }
  const img = document.createElement("img");
  img.src = `/api/admin/media/${item.id}/source?preview=1`;
  img.alt = item.caption || item.filename;
  host.append(img);
}
function syncCurrentContentPanels() {
  const id = document.getElementById("content-id").value;
  document
    .querySelectorAll(".article-linked-panel")
    .forEach((panel) => panel.classList.toggle("hidden", !id));
  renderArticleAssets();
  renderCurrentContentComments();
}
function articleEditorAssetIds() {
  return new Set(
    [
      ...document.querySelectorAll(
        "#content-editor .resource-embed[data-resource-type='asset'][data-resource-id]"
      )
    ]
      .map((node) => node.dataset.resourceId)
      .filter(Boolean)
  );
}
function resetArticleAttachmentTracking(trackCurrent = false) {
  app.editorRange = null;
  app.editorFontSize = "16";
  app.articleSessionAssetIds = trackCurrent ? articleEditorAssetIds() : new Set();
  app.articleAssetRemovalDecisions = new Map();
}
function decideArticleAssetRemoval(assetId) {
  if (!assetId) return false;
  if (app.articleAssetRemovalDecisions.has(assetId))
    return app.articleAssetRemovalDecisions.get(assetId);
  const item = app.assets.find((asset) => asset.id === assetId);
  const label = item?.display_name || "这个附件";
  const permanentlyDelete = confirm(
    `“${label}”已从文章正文移除。\n\n是否同时将该文件从网站永久删除？\n确定：永久删除文件\n取消：保留在当前文章附件栏，只是不再显示在正文中`
  );
  app.articleAssetRemovalDecisions.set(assetId, permanentlyDelete);
  return permanentlyDelete;
}
function removedArticleAssetIdsForSave() {
  const current = articleEditorAssetIds();
  const removed = [...app.articleSessionAssetIds].filter((assetId) => !current.has(assetId));
  removed.forEach(decideArticleAssetRemoval);
  return removed.filter((assetId) => app.articleAssetRemovalDecisions.get(assetId) === true);
}
function resetContentForm({ open = false } = {}) {
  resetStudioArticleImages();
  studioWorkspace.articleOpen = open;
  const board = currentStudioBoard();
  const form = document.getElementById("content-form");
  form.reset();
  document.getElementById("content-title").value = "";
  document.getElementById("content-excerpt").value = "";
  document.getElementById("content-cover").value = "";
  document.getElementById("content-id").value = "";
  refreshCoverOptions();
  document.getElementById("content-editor").innerHTML = "<p></p>";
  resetArticleAttachmentTracking(false);
  clear(document.getElementById("article-upload-queue"));
  app.assetUploadContext = null;
  document.getElementById("delete-content").classList.add("hidden");
  document.getElementById("content-notice").textContent = "";
  document.getElementById("article-asset-notice").textContent =
    "请先保存文章草稿，再上传只属于这篇文章的附件。";
  syncAudiencePicker("content-visibility", "content-user-picker", []);
  if (board) document.getElementById("content-section").value = board.section.id;
  refreshContentSubsectionOptions(
    document.getElementById("content-section").value,
    board?.kind === "subsection" ? board.item.id : ""
  );
  updateCoverPreview();
  syncCurrentContentPanels();
  markStudioClean(form);
  renderContentList();
}
function editContent(item) {
  if (document.getElementById("content-id").value !== item.id) resetStudioArticleImages();
  studioWorkspace.articleOpen = true;
  const form = document.getElementById("content-form");
  const sectionId = item.section_id || (item.type === "guide" ? "section-guides" : "section-essays");
  document.getElementById("content-id").value = item.id;
  document.getElementById("content-section").value = sectionId;
  refreshContentSubsectionOptions(sectionId, item.subsection_id || "");
  document.getElementById("content-status").value = item.status;
  document.getElementById("content-visibility").value = item.visibility || "public";
  syncAudiencePicker("content-visibility", "content-user-picker", item.allowed_user_ids || []);
  document.getElementById("content-title").value = item.title;
  document.getElementById("content-excerpt").value = item.excerpt || "";
  document.getElementById("content-cover").value = "";
  refreshCoverOptions();
  document.getElementById("content-cover").value = item.cover_media_id || "";
  document.getElementById("content-editor").innerHTML = item.body_html || "<p></p>";
  hydrateStudioArticleImages();
  resetArticleAttachmentTracking(true);
  clear(document.getElementById("article-upload-queue"));
  app.assetUploadContext = null;
  document.getElementById("delete-content").classList.remove("hidden");
  document.getElementById("article-asset-notice").textContent = "";
  updateCoverPreview();
  syncCurrentContentPanels();
  markStudioClean(form);
  renderContentList();
}
function contentPayload(deleteAssetIds = []) {
  const sectionId = document.getElementById("content-section").value;
  return {
    sectionId,
    subsectionId: document.getElementById("content-subsection").value || null,
    type: sectionId === "section-guides" ? "guide" : "article",
    status: document.getElementById("content-status").value,
    ...visibilityPayload("content-visibility", "content-user-picker"),
    title: document.getElementById("content-title").value,
    excerpt: document.getElementById("content-excerpt").value,
    coverMediaId: document.getElementById("content-cover").value,
    bodyHtml: studioArticleBodyHtml(),
    deleteAssetIds
  };
}
