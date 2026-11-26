async function loadSections() {
  app.sections = await api("/api/admin/sections");
  renderSectionList();
  refreshSectionOptions();
  renderContentStructureNav();
}
function renderSectionList() {
  const list = document.getElementById("section-list");
  clear(list);
  if (!app.sections.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "还没有大板块。";
    list.append(p);
    return;
  }
  app.sections
    .filter((item) => item.kind === studioSectionCategory)
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = `list-item${document.getElementById("section-id").value === item.id ? " active" : ""}`;
      const title = document.createElement("div");
      title.className = "list-title";
      title.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "list-meta";
      const audience = visibilityUsesAudience(item.visibility)
        ? `（${item.allowed_user_ids?.length || 0} 人）`
        : "";
      const kindLabel =
        item.kind === "gallery" ? "图片类" : item.kind === "resources" ? "文件资源类" : "文章类";
      const counts = `小板块 ${item.subsection_count || 0} · 文章 ${item.content_count || 0} · 图片 ${item.media_count || 0} · 文件 ${item.resource_count || 0}`;
      meta.textContent = `${kindLabel} · ${visibilityLabels[item.visibility] || visibilityLabels.public}${audience} · ${counts}`;
      row.append(title, meta);
      row.addEventListener("click", () => editSection(item));
      list.append(row);
    });
}
function resetSectionForm() {
  const form = document.getElementById("section-form");
  form.reset();
  document.getElementById("section-id").value = "";
  document.getElementById("section-kind").disabled = false;
  document.getElementById("section-sort").value = "0";
  document.getElementById("section-show-all").checked = true;
  document.getElementById("delete-section").classList.add("hidden");
  document.getElementById("section-notice").textContent = "";
  syncAudiencePicker("section-visibility", "section-user-picker", []);
  document.getElementById("section-kind").value = studioSectionCategory;
  app.sectionEditorLevel = "section";
  setStudioPresentation("section");
  markStudioClean(form);
  renderSectionList();
  renderContentStructureNav();
}
function editSection(item) {
  studioWorkspace.creating = "";
  const form = document.getElementById("section-form");
  app.sectionEditorLevel = "section";
  document
    .querySelectorAll("[data-section-editor-level]")
    .forEach((node) => node.classList.toggle("active", node.dataset.sectionEditorLevel === "section"));
  document.getElementById("section-id").value = item.id;
  document.getElementById("section-name").value = item.name;
  document.getElementById("section-kind").value = item.kind;
  document.getElementById("section-kind").disabled = item.id === "section-resources";
  document.getElementById("section-description").value = item.description || "";
  document.getElementById("section-sort").value = item.sort_order || 0;
  document.getElementById("section-visibility").value = item.visibility || "public";
  syncAudiencePicker("section-visibility", "section-user-picker", item.allowed_user_ids || []);
  document.getElementById("section-show-all").checked = Number(item.show_all) !== 0;
  document
    .getElementById("delete-section")
    .classList.toggle("hidden", item.id === "section-resources");
  setStudioPresentation("section", item);
  markStudioClean(form);
  renderSectionList();
  renderContentStructureNav();
  rememberStudioBoard();
  if (app.currentView === "sections") syncInlineContentSelection(item);
}
function sectionPayload() {
  return {
    ...studioPresentationPayload("section"),
    name: document.getElementById("section-name").value,
    kind: document.getElementById("section-kind").value,
    description: document.getElementById("section-description").value,
    sortOrder: Number(document.getElementById("section-sort").value || 0),
    ...visibilityPayload("section-visibility", "section-user-picker"),
    showAll: document.getElementById("section-show-all").checked
  };
}
function refreshSectionOptions() {
  const contentSelect = document.getElementById("content-section");
  const mediaSelect = document.getElementById("media-section");
  const subsectionSection = document.getElementById("subsection-section");
  const currentContent = contentSelect.value;
  const currentMedia = mediaSelect.value;
  const currentSubsectionSection = subsectionSection.value;
  clear(contentSelect);
  clear(mediaSelect);
  clear(subsectionSection);
  app.sections
    .filter((item) => item.kind === "content")
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      contentSelect.append(option);
    });
  app.sections
    .filter((item) => item.kind === studioSectionCategory)
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      subsectionSection.append(option);
    });
  app.sections
    .filter(
      (item) =>
        item.kind === "gallery" ||
        app.media.some((photo) => photo.kind === "photo" && photo.section_id === item.id)
    )
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      mediaSelect.append(option);
    });
  if ([...contentSelect.options].some((o) => o.value === currentContent))
    contentSelect.value = currentContent;
  if ([...mediaSelect.options].some((o) => o.value === currentMedia)) mediaSelect.value = currentMedia;
  if ([...subsectionSection.options].some((o) => o.value === currentSubsectionSection))
    subsectionSection.value = currentSubsectionSection;
  refreshContentSubsectionOptions(contentSelect.value);
  refreshMediaSubsectionOptions(mediaSelect.value);
  fillAssetSections();
  refreshAssetSubsectionOptions();
  fillSubsectionParents(document.getElementById("subsection-parent").value);
}

async function loadSubsections() {
  app.subsections = await api("/api/admin/subsections");
  renderSubsectionList();
  refreshContentSubsectionOptions(document.getElementById("content-section").value);
  refreshMediaSubsectionOptions(document.getElementById("media-section").value);
  refreshAssetSubsectionOptions();
  fillSubsectionParents(document.getElementById("subsection-parent").value);
  renderContentStructureNav();
}
function renderSubsectionList() {
  const list = document.getElementById("subsection-list");
  clear(list);
  if (!app.subsections.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "还没有小板块。每一种大板块都可以在这里建立小板块。";
    list.append(p);
    return;
  }
  app.subsections
    .filter(
      (item) =>
        app.sections.find((section) => section.id === item.section_id)?.kind === studioSectionCategory
    )
    .forEach((item) => {
      const section = app.sections.find((value) => value.id === item.section_id);
      const row = document.createElement("div");
      row.className = `list-item${document.getElementById("subsection-id").value === item.id ? " active" : ""}`;
      const title = document.createElement("div");
      title.className = "list-title";
      title.textContent = subsectionPath(item);
      const meta = document.createElement("div");
      meta.className = "list-meta";
      const downloadLabel =
        item.download_policy === "member" ? "仅审核用户下载" : "按文件权限允许游客下载";
      meta.textContent = `${section?.name || "未知大板块"} · 查看：${visibilityLabels[item.visibility] || visibilityLabels.public} · 下载：${downloadLabel} · 文章 ${item.content_count || 0} · 图片 ${item.media_count || 0} · 文件 ${item.asset_count || 0} · 排序 ${item.sort_order || 0}`;
      row.append(title, meta);
      row.addEventListener("click", () => editSubsection(item));
      list.append(row);
    });
}
function resetSubsectionForm({
  sectionId = "",
  parentId = "",
  creationLevel = parentId ? "child" : "subsection"
} = {}) {
  const form = document.getElementById("subsection-form");
  form.reset();
  form.dataset.creationLevel = creationLevel;
  document.getElementById("subsection-id").value = "";
  document.getElementById("subsection-sort").value = "0";
  document.getElementById("subsection-download-policy").value = "public";
  document.getElementById("delete-subsection").classList.add("hidden");
  document.getElementById("subsection-notice").textContent = "";
  syncAudiencePicker("subsection-visibility", "subsection-user-picker", []);
  refreshSectionOptions();
  if (sectionId) document.getElementById("subsection-section").value = sectionId;
  fillSubsectionParents(parentId);
  setSectionEditorLevel("subsection");
  setStudioPresentation("subsection");
  markStudioClean(form);
  renderSubsectionList();
}
function editSubsection(item) {
  studioWorkspace.creating = "";
  const form = document.getElementById("subsection-form");
  form.dataset.creationLevel = "";
  app.sectionEditorLevel = "subsection";
  document
    .querySelectorAll("[data-section-editor-level]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.sectionEditorLevel === "subsection")
    );
  document.getElementById("subsection-id").value = item.id;
  document.getElementById("subsection-section").value = item.section_id;
  fillSubsectionParents(item.parent_id || "");
  document.getElementById("subsection-name").value = item.name;
  document.getElementById("subsection-description").value = item.description || "";
  document.getElementById("subsection-sort").value = item.sort_order || 0;
  document.getElementById("subsection-visibility").value = item.visibility || "public";
  document.getElementById("subsection-download-policy").value = item.download_policy || "public";
  syncAudiencePicker("subsection-visibility", "subsection-user-picker", item.allowed_user_ids || []);
  document.getElementById("delete-subsection").classList.remove("hidden");
  setStudioPresentation("subsection", item);
  markStudioClean(form);
  renderSubsectionList();
  renderContentStructureNav();
  rememberStudioBoard();
  const section = app.sections.find((value) => value.id === item.section_id);
  if (app.currentView === "sections" && section) syncInlineContentSelection(section, item);
}
function fillSubsectionSelect(select, sectionId, selectedId = "", noneText = "未分类") {
  if (!select) return;
  const current = selectedId || select.value;
  clear(select);
  const none = document.createElement("option");
  none.value = "";
  none.textContent = noneText;
  select.append(none);
  app.subsections
    .filter((item) => item.section_id === sectionId)
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = subsectionPath(item);
      select.append(option);
    });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}
function refreshContentSubsectionOptions(sectionId, selectedId = "") {
  fillSubsectionSelect(document.getElementById("content-subsection"), sectionId, selectedId);
  renderContentSectionAssets();
}
function refreshMediaSubsectionOptions(sectionId, selectedId = "") {
  fillSubsectionSelect(document.getElementById("media-subsection"), sectionId, selectedId, "全部");
  fillSubsectionSelect(document.getElementById("media-album"), sectionId, selectedId);
}
function refreshAssetSubsectionOptions(selectedId = "") {
  fillSubsectionSelect(document.getElementById("asset-subsection"), currentAssetSection(), selectedId);
}
