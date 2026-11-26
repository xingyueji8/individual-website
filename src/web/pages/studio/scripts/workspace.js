const studioDirtyForms = new Set();
const articlePanelVisibility = { settings: false, editor: true };
function syncArticlePanels() {
  const settingsVisible = articlePanelVisibility.settings,
    editorVisible = articlePanelVisibility.editor;
  const layout = document.getElementById("content-manager-layout");
  document.getElementById("content-panel-controls").hidden = !(
    currentStudioBoard() || studioWorkspace.creating
  );
  document.querySelectorAll("[data-content-panel-close]").forEach((control) => {
    control.hidden = false;
  });
  document.getElementById("content-settings-panel").hidden = !settingsVisible;
  document.getElementById("content-editor-panel").hidden = !editorVisible;
  for (const name of ["settings", "editor"]) {
    const control = document.getElementById(`content-${name}-open`);
    control.setAttribute("aria-expanded", String(articlePanelVisibility[name]));
    control.classList.toggle("active", articlePanelVisibility[name]);
  }
  document.getElementById("content-settings-open").textContent = "板块设置";
  layout.classList.add("has-article-panel-controls");
  layout.classList.toggle("has-one-panel", settingsVisible !== editorVisible);
  document.getElementById("content-panels-empty").hidden = settingsVisible || editorVisible;
}
function setArticlePanelVisible(name, visible) {
  if (!Object.hasOwn(articlePanelVisibility, name)) return;
  if (visible) {
    articlePanelVisibility.settings = false;
    articlePanelVisibility.editor = false;
  }
  articlePanelVisibility[name] = visible;
  syncArticlePanels();
  if (!visible) document.getElementById(`content-${name}-open`).focus();
}
function markStudioDirty(form) {
  if (form) studioDirtyForms.add(form);
}
function markStudioClean(form) {
  if (form) studioDirtyForms.delete(form);
}
function activeStudioDirtyForms() {
  const view = document.querySelector(".view.active");
  return [...studioDirtyForms].filter((form) => view?.contains(form));
}
function activeStudioUploadJobs() {
  const view = document.querySelector(".view.active");
  return [...app.activeUploadJobs].filter((job) => job.element && view?.contains(job.element));
}
function photoWorkspaceActive() {
  return (
    app.currentView === "media" ||
    (app.currentView === "sections" && studioSectionCategory === "gallery")
  );
}
function hasStudioWorkInProgress() {
  return (
    activeStudioDirtyForms().length > 0 ||
    activeStudioUploadJobs().length > 0 ||
    (photoWorkspaceActive() && photoSelection.length > 0)
  );
}
function confirmStudioNavigation() {
  if (!hasStudioWorkInProgress()) return true;
  const details = [];
  if (activeStudioDirtyForms().length) details.push("尚未保存的修改");
  if (activeStudioUploadJobs().length) details.push("正在进行的上传（返回后仍会继续）");
  if (photoWorkspaceActive() && photoSelection.length)
    details.push(sendingPhotos ? "正在处理的照片上传（返回后仍会继续）" : "尚未上传的图片预览");
  return confirm(`当前还有${details.join("、")}。确定离开当前界面吗？`);
}
function discardCurrentStudioDraft() {
  activeStudioDirtyForms().forEach((form) => {
    if (form.id === "section-form") resetSectionForm();
    else if (form.id === "subsection-form") resetSubsectionForm();
    else if (form.id === "content-form") resetContentForm();
    else {
      form.reset();
      markStudioClean(form);
    }
  });
  if (photoWorkspaceActive() && !sendingPhotos)
    for (const entry of [...photoSelection]) removePhotoSelection(entry);
}
function updateStudioBackButton() {
  document
    .getElementById("studio-back-button")
    .classList.toggle("hidden", app.currentView === "dashboard" && !app.viewHistory.length);
}
function switchView(name, { record = true, force = false } = {}) {
  const target = document.getElementById(`view-${name}`);
  if (!target) return false;
  const current =
    app.currentView || document.querySelector(".view.active")?.id.replace(/^view-/, "") || "dashboard";
  if (name !== current && !force) {
    if (!confirmStudioNavigation()) return false;
    discardCurrentStudioDraft();
  }
  if (record && name !== current) {
    app.viewHistory.push(current);
    if (app.viewHistory.length > 20) app.viewHistory.shift();
  }
  app.currentView = name;
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  const contentViews = new Set(["site-content", "sections", "content", "media", "assets"]);
  document
    .querySelectorAll(".side-nav button")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        b.dataset.view === name || (b.dataset.view === "site-content" && contentViews.has(name))
      )
    );
  document.getElementById("studio-primary-nav").classList.remove("hidden");
  const info = viewInfo[name] || viewInfo.dashboard;
  document.getElementById("view-title").textContent = info[0];
  document.getElementById("view-desc").textContent = info[1];
  updateStudioBackButton();
  if (name === "messages")
    loadStudioMessages().catch((error) => {
      document.getElementById("studio-message-title").textContent = error.message;
    });
  if (name === "settings") loadEntryBackgroundSettings();
  return true;
}
function studioGoBack() {
  const fallback = app.currentView === "sections" ? "site-content" : "dashboard";
  const target = app.viewHistory.at(-1) || fallback;
  if (switchView(target, { record: false })) {
    if (app.viewHistory.at(-1) === target) app.viewHistory.pop();
    updateStudioBackButton();
  }
}
function contentCategoryMeta(kind = studioSectionCategory) {
  return kind === "gallery"
    ? { label: "图片", view: "media" }
    : kind === "resources"
      ? { label: "文件与视频", view: "assets" }
      : { label: "文章", view: "content" };
}
function syncContentManagerMeta() {
  const meta = contentCategoryMeta();
  syncArticlePanels();
  document.getElementById("content-manager-title").textContent = `${meta.label}板块与内容`;
  document.getElementById("side-content-title").textContent = `${meta.label}层级`;
  document.getElementById("content-inline-title").textContent = `${meta.label}内容`;
  if (app.currentView === "sections") {
    document.getElementById("view-title").textContent = `${meta.label}管理`;
    document.getElementById("view-desc").textContent =
      "先从目录选择已有板块，再管理内容；名称、权限与样式在“板块设置”中修改。";
  }
}
function initializeEmbeddedContentEditors() {
  const host = document.getElementById("content-inline-editor-host");
  for (const name of ["content", "media", "assets"]) {
    const view = document.getElementById(`view-${name}`);
    if (!view) continue;
    view.classList.remove("view");
    view.classList.add("content-inline-view");
    view.dataset.inlineView = name;
    host.append(view);
  }
}
function showInlineContentEditor() {
  const name = contentCategoryMeta().view;
  document
    .querySelectorAll(".content-inline-view")
    .forEach((view) => view.classList.toggle("active", view.dataset.inlineView === name));
}
function syncInlineContentSelection(section, subsection = null) {
  if (!section) return;
  const subsectionId = subsection?.id || "";
  const meta = contentCategoryMeta(section.kind);
  showInlineContentEditor();
  document.getElementById("content-inline-scope").textContent = subsection
    ? `${section.name} / ${subsection.name}`
    : `${section.name} / 全部内容`;
  if (meta.view === "content") {
    const editing = app.content.find(
      (item) => item.id === document.getElementById("content-id").value
    );
    if (
      editing &&
      (editing.section_id !== section.id || (subsectionId && editing.subsection_id !== subsectionId))
    )
      resetContentForm();
    document.getElementById("content-section").value = section.id;
    refreshContentSubsectionOptions(section.id, subsectionId);
    renderContentList();
    renderContentSectionAssets();
  } else if (meta.view === "media") {
    document.getElementById("media-section").value = section.id;
    renderAlbums();
    refreshMediaSubsectionOptions(section.id, subsectionId);
    document.getElementById("media-subsection").value = subsectionId;
    document.getElementById("media-album").value = subsectionId;
    renderMedia();
  } else {
    document.getElementById("asset-section").value = section.id;
    app.currentAssetFolder = "";
    refreshAssetSubsectionOptions(subsectionId);
    document.getElementById("asset-subsection").value = subsectionId;
    renderAssetFolderOptions();
    renderAssetBrowser();
  }
}
function setSectionEditorLevel(level) {
  app.sectionEditorLevel = level;
  document
    .querySelectorAll("[data-section-editor-level]")
    .forEach((node) => node.classList.toggle("active", node.dataset.sectionEditorLevel === level));
  renderContentStructureNav();
}
function studioCreationContext() {
  const subsection =
    app.sectionEditorLevel === "subsection"
      ? app.subsections.find((item) => item.id === document.getElementById("subsection-id").value)
      : null;
  const sectionId =
    subsection?.section_id ||
    (app.sectionEditorLevel === "subsection"
      ? document.getElementById("subsection-section").value
      : document.getElementById("section-id").value);
  const section = app.sections.find(
    (item) => item.id === sectionId && item.kind === studioSectionCategory
  );
  const draftParent =
    app.sectionEditorLevel === "subsection"
      ? app.subsections.find((item) => item.id === document.getElementById("subsection-parent").value)
      : null;
  const parent = subsection?.parent_id
    ? app.subsections.find((item) => item.id === subsection.parent_id)
    : subsection || draftParent;
  return { section, parent: parent?.section_id === section?.id ? parent : null };
}
function syncStudioCreationControls() {
  const { section, parent } = studioCreationContext();
  const small = document.getElementById("create-subsection"),
    child = document.getElementById("create-subsection-child");
  // Keep both entry points actionable: a missing parent is explained in the
  // editor instead of silently disabling a button (especially on touchscreens).
  small.disabled = false;
  small.title = section ? `在“${section.name}”中新建小板块` : "新建小板块并选择所属大板块";
  child.disabled = false;
  child.title = parent ? `在“${parent.name}”中新建小小板块` : "新建小小板块并选择上级小板块";
  const add = document.getElementById("content-structure-new");
  add.dataset.createLevel = "section";
  const label = "新建大板块";
  add.title = label;
  add.setAttribute("aria-label", label);
}
function startStudioCreation(level) {
  const context = studioCreationContext();
  const section =
    context.section ||
    app.sections
      .filter((item) => item.kind === studioSectionCategory)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0];
  const parent = context.parent?.section_id === section?.id ? context.parent : null;
  if (level !== "section" && !section) {
    alert("当前分类还没有已保存的大板块，请先点击“新建大板块”并保存，再建立小板块或小小板块。");
    return false;
  }
  // Resolve parents before discarding a draft, because resets clear IDs.
  if (!confirmStudioNavigation()) return false;
  discardCurrentStudioDraft();
  setArticlePanelVisible("settings", true);
  if (level === "section") {
    resetSectionForm();
    setSectionEditorLevel("section");
  } else {
    resetSubsectionForm({
      sectionId: section.id,
      parentId: level === "child" ? parent?.id || "" : "",
      creationLevel: level
    });
    syncInlineContentSelection(section, level === "child" ? parent : null);
  }
  studioWorkspace.creating = level;
  renderContentStructureNav();
  const field = document.getElementById(
    level === "section"
      ? "section-name"
      : level === "child" && !parent
        ? "subsection-parent"
        : "subsection-name"
  );
  field.focus({ preventScroll: true });
  field.scrollIntoView?.({ block: "center", behavior: "smooth" });
  return true;
}
function syncSubsectionEditorState() {
  const form = document.getElementById("subsection-form");
  const parentSelect = document.getElementById("subsection-parent");
  const section = app.sections.find(
    (item) => item.id === document.getElementById("subsection-section").value
  );
  const parent = app.subsections.find(
    (item) => item.id === parentSelect.value && item.section_id === section?.id && !item.parent_id
  );
  const isChild = form.dataset.creationLevel === "child" || Boolean(parent);
  const editing = Boolean(document.getElementById("subsection-id").value);
  const label = isChild ? "小小板块" : "小板块";
  parentSelect.required = form.dataset.creationLevel === "child";
  document.getElementById("subsection-form-title").textContent =
    `${editing ? "编辑" : "新建"}${label}`;
  document.getElementById("subsection-save").textContent = `保存${label}`;
  let description = section
    ? `所属大板块：${section.name}${parent ? ` / ${parent.name}` : ""}。填写名称后点击“保存${label}”。`
    : "请选择所属大板块。";
  if (isChild && !parent) {
    const hasParents = app.subsections.some(
      (item) => item.section_id === section?.id && !item.parent_id
    );
    description = hasParents
      ? "请选择上级小板块，再填写名称并保存小小板块。"
      : "当前大板块还没有小板块，请先点击“新建小板块”并保存，再建立小小板块。";
  }
  document.getElementById("subsection-form-description").textContent = description;
}
function renderContentStructureNav() {
  renderStudioBoardCatalog();
}
function enterSectionManager(kind) {
  return enterStudioContentCategory(kind);
}
function initializeStudioSafetyNavigation() {
  document
    .querySelectorAll("[data-content-panel-open]")
    .forEach((control) =>
      control.addEventListener("click", () =>
        setArticlePanelVisible(control.dataset.contentPanelOpen, true)
      )
    );
  document
    .querySelectorAll("[data-content-panel-close]")
    .forEach((control) =>
      control.addEventListener("click", () =>
        setArticlePanelVisible(control.dataset.contentPanelClose, false)
      )
    );
  ["section-form", "subsection-form", "content-form", "media-form"].forEach((id) => {
    const form = document.getElementById(id);
    form.addEventListener("input", (event) => {
      if (!event.target.closest("button")) markStudioDirty(form);
    });
    form.addEventListener("change", (event) => {
      if (!event.target.closest("button")) markStudioDirty(form);
    });
  });
  document.getElementById("studio-back-button").addEventListener("click", studioGoBack);
  document
    .querySelectorAll("[data-view-target]")
    .forEach((control) =>
      control.addEventListener("click", () => switchView(control.dataset.viewTarget))
    );
  document
    .querySelectorAll("[data-studio-create]")
    .forEach((control) =>
      control.addEventListener("click", () => startStudioCreation(control.dataset.studioCreate))
    );
}
