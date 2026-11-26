document.getElementById("new-content").addEventListener("click", startStudioArticle);
document.getElementById("refresh-content").addEventListener("click", loadContent);
document.getElementById("content-section").addEventListener("change", (event) => {
  refreshContentSubsectionOptions(event.target.value);
  renderContentList();
});
document.getElementById("content-subsection").addEventListener("change", () => {
  renderContentSectionAssets();
  renderContentList();
});
document.getElementById("content-visibility").addEventListener("change", () => {
  const picker = document.getElementById("content-user-picker");
  picker.classList.toggle(
    "hidden",
    !visibilityUsesAudience(document.getElementById("content-visibility").value)
  );
});
document.getElementById("content-cover").addEventListener("change", updateCoverPreview);
document.getElementById("content-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("content-id").value;
  const notice = document.getElementById("content-notice");
  if (studioArticleImages.coverBusy || studioArticleImages.inlineBusy) {
    notice.textContent = "图片正在上传，请完成或停止上传后再保存文章。";
    return;
  }
  const deleteAssetIds = id ? removedArticleAssetIdsForSave() : [];
  const payload = contentPayload(deleteAssetIds);
  if (!validateVisibilityChoice(payload, notice)) return;
  notice.textContent = "正在保存…";
  try {
    const result = await api(id ? `/api/admin/content/${id}` : "/api/admin/content", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const failedDeletes = result.failedDeleteAssetIds?.length || 0;
    notice.textContent = failedDeletes
      ? `文章已保存，但有 ${failedDeletes} 个附件删除失败并已保留。`
      : "已保存。";
    await Promise.all([
      loadContent(),
      loadAlbumsAndMedia(),
      loadDashboard(),
      ...(deleteAssetIds.length ? [loadAssets()] : [])
    ]);
    const saved = app.content.find((item) => item.id === (id || result.id));
    if (saved) editContent(saved);
  } catch (error) {
    notice.textContent = error.message;
  }
});
document.getElementById("delete-content").addEventListener("click", async () => {
  const id = document.getElementById("content-id").value;
  if (!id || !confirm("确定删除这篇内容及其全部评论吗？")) return;
  await api(`/api/admin/content/${id}`, { method: "DELETE" });
  resetContentForm();
  await loadContent();
  await loadComments();
  await loadDashboard();
});
document
  .querySelectorAll("[data-command]")
  .forEach((b) => b.addEventListener("click", () => applyStudioEditorCommand(b.dataset.command)));
document
  .querySelectorAll("[data-block]")
  .forEach((b) =>
    b.addEventListener("click", () => applyStudioEditorCommand("formatBlock", b.dataset.block))
  );
/*
 * 文章可直接粘贴纯文本网址，公开阅读页会自动识别；也可以用“链接”按钮
 * 把选中的文字设为链接。这里只接受 http/https，拒绝 javascript: 等协议。
 */
document.getElementById("insert-link").addEventListener("click", () => {
  const editor = document.getElementById("content-editor");
  const selection = getSelection();
  const savedRange =
    selection.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const value = prompt("链接地址（以 http:// 或 https:// 开头）");
  if (!value) return;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    editor.focus();
    if (savedRange) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    if (savedRange && !savedRange.collapsed) document.execCommand("createLink", false, url.href);
    else {
      const anchor = document.createElement("a");
      anchor.href = url.href;
      anchor.textContent = url.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      const range = savedRange || document.createRange();
      if (!savedRange) range.selectNodeContents(editor);
      range.collapse(false);
      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch {
    alert("网址格式不正确，请填写完整的 http:// 或 https:// 地址。");
  }
});
document.getElementById("insert-resource").addEventListener("click", () => {
  const selection = getSelection();
  app.editorRange =
    selection.rangeCount && document.getElementById("content-editor").contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  renderResourcePicker();
  document.getElementById("resource-picker").showModal();
});
document
  .getElementById("resource-picker-close")
  .addEventListener("click", () => document.getElementById("resource-picker").close());
document.getElementById("content-editor").addEventListener("click", (event) => {
  document
    .querySelectorAll("#content-editor .resource-embed.is-selected")
    .forEach((node) => node.classList.remove("is-selected"));
  event.target.closest?.(".resource-embed")?.classList.add("is-selected");
});
document.getElementById("remove-editor-resource").addEventListener("click", () => {
  const selected = document.querySelector("#content-editor .resource-embed.is-selected");
  if (!selected) {
    alert("请先点击正文中要删除的文件卡片。");
    return;
  }
  const assetId = selected.dataset.resourceType === "asset" ? selected.dataset.resourceId : "";
  if (assetId) app.articleSessionAssetIds.add(assetId);
  const permanentlyDelete = assetId ? decideArticleAssetRemoval(assetId) : false;
  selected.remove();
  document.getElementById("content-notice").textContent = permanentlyDelete
    ? "资源已移出正文；保存文章后会同时永久删除该附件。"
    : "资源已移出正文；保存文章后仍会保留在当前文章附件栏。";
});
