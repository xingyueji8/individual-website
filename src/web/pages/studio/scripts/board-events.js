document.getElementById("refresh-sections").addEventListener("click", loadSections);
document
  .getElementById("section-visibility")
  .addEventListener("change", () =>
    syncAudiencePicker(
      "section-visibility",
      "section-user-picker",
      selectedAudienceIds("section-user-picker")
    )
  );
document.getElementById("section-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("section-id").value;
  const notice = document.getElementById("section-notice");
  const payload = sectionPayload();
  if (!validateVisibilityChoice(payload, notice)) return;
  notice.textContent = "正在保存…";
  try {
    const result = await api(id ? `/api/admin/sections/${id}` : "/api/admin/sections", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    studioSectionCategory = payload.kind;
    syncContentManagerMeta();
    await loadSections();
    const saved = app.sections.find((item) => item.id === (id || result.id));
    if (saved) editSection(saved);
    notice.textContent = "板块已保存，可继续设置下载权限和内容锁。";
    await loadContent();
    await loadAlbumsAndMedia();
    await loadDashboard();
  } catch (error) {
    notice.textContent = error.message;
  }
});
document.getElementById("delete-section").addEventListener("click", async () => {
  const id = document.getElementById("section-id").value;
  const item = app.sections.find((s) => s.id === id);
  if (!item) return;
  const warning = `确定删除大板块“${item.name}”吗？\n\n该板块内的文章、评论、小板块、图片和 R2 原文件都会一并永久删除，此操作不可撤销。`;
  if (!confirm(warning)) return;
  await api(`/api/admin/sections/${id}`, { method: "DELETE" });
  resetSectionForm();
  await loadSections();
  await loadContent();
  await loadAlbumsAndMedia();
  await loadComments();
  await loadDashboard();
});
document.getElementById("refresh-subsections").addEventListener("click", loadSubsections);
document
  .getElementById("subsection-visibility")
  .addEventListener("change", () =>
    syncAudiencePicker(
      "subsection-visibility",
      "subsection-user-picker",
      selectedAudienceIds("subsection-user-picker")
    )
  );
document.getElementById("subsection-parent").addEventListener("change", () => {
  syncSubsectionEditorState();
  syncStudioCreationControls();
});
document.getElementById("subsection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("subsection-id").value;
  const notice = document.getElementById("subsection-notice");
  const access = visibilityPayload("subsection-visibility", "subsection-user-picker");
  if (!validateVisibilityChoice(access, notice)) return;
  const sectionId = document.getElementById("subsection-section").value;
  const parentSelect = document.getElementById("subsection-parent");
  const parentId = parentSelect.value || null;
  if (!app.sections.some((item) => item.id === sectionId && item.kind === studioSectionCategory)) {
    notice.textContent = "请先选择一个已保存的大板块。";
    document.getElementById("subsection-section").focus();
    return;
  }
  if (
    (event.currentTarget.dataset.creationLevel === "child" && !parentId) ||
    (parentId &&
      !app.subsections.some(
        (item) => item.id === parentId && item.section_id === sectionId && !item.parent_id
      ))
  ) {
    notice.textContent = "请选择当前大板块下的上级小板块，才能保存小小板块。";
    parentSelect.focus();
    return;
  }
  notice.textContent = "正在保存…";
  try {
    const result = await api(id ? `/api/admin/subsections/${id}` : "/api/admin/subsections", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...studioPresentationPayload("subsection"),
        sectionId,
        parentId,
        name: document.getElementById("subsection-name").value,
        description: document.getElementById("subsection-description").value,
        sortOrder: Number(document.getElementById("subsection-sort").value || 0),
        downloadPolicy: document.getElementById("subsection-download-policy").value,
        ...access
      })
    });
    await loadSubsections();
    const saved = app.subsections.find((item) => item.id === (id || result.id));
    if (saved) editSubsection(saved);
    notice.textContent = "小板块的查看与下载权限已保存。";
  } catch (error) {
    notice.textContent = error.message;
  }
});
document.getElementById("delete-subsection").addEventListener("click", async () => {
  const id = document.getElementById("subsection-id").value;
  if (!id || !confirm("删除后，原有文章、图片和文件都会保留并变为未分类。确定继续吗？")) return;
  await api(`/api/admin/subsections/${id}`, { method: "DELETE" });
  resetSubsectionForm();
  await Promise.all([loadSubsections(), loadContent(), loadAlbumsAndMedia(), loadAssets()]);
});
