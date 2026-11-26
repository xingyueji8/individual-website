/* Content management: choose an existing board, then browse or edit its content. */
const studioWorkspace = { remembered: {}, creating: "", query: "", articleOpen: false, status: "idle", error: "", loading: null };
try { studioWorkspace.remembered = JSON.parse(localStorage.getItem("xyj-studio-board-selection") || "{}") || {}; } catch {}
if (typeof studioWorkspace.remembered !== "object" || Array.isArray(studioWorkspace.remembered)) studioWorkspace.remembered = {};

function currentStudioBoard() {
  const kind = app.sectionEditorLevel === "subsection" ? "subsection" : "section";
  const id = document.getElementById(`${kind}-id`).value;
  const item = (kind === "section" ? app.sections : app.subsections).find(value => value.id === id);
  const section = kind === "section" ? item : app.sections.find(value => value.id === item?.section_id);
  return item && section?.kind === studioSectionCategory ? { kind, item, section } : null;
}
function studioBoardDescendants(board) {
  const ids = new Set(board?.kind === "subsection" ? [board.item.id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of app.subsections) if (item.section_id === board?.section.id && (board.kind === "section" || ids.has(item.parent_id)) && !ids.has(item.id)) {
      ids.add(item.id); changed = true;
    }
  }
  return ids;
}
function studioBoardIncludes(board, item, descendants = studioBoardDescendants(board)) {
  return Boolean(board && item.section_id === board.section.id && (board.kind === "section" || descendants.has(item.subsection_id)));
}
function rememberStudioBoard() {
  const board = currentStudioBoard(); if (!board) return;
  studioWorkspace.remembered[studioSectionCategory] = { kind: board.kind, id: board.item.id };
  try { localStorage.setItem("xyj-studio-board-selection", JSON.stringify(studioWorkspace.remembered)); } catch {}
}
function selectStudioBoard(kind, id, { force = false } = {}) {
  const item = (kind === "section" ? app.sections : app.subsections).find(item => item.id === id);
  const section = kind === "section" ? item : app.sections.find(value => value.id === item?.section_id);
  if (!item || section?.kind !== studioSectionCategory) return false;
  if (!force) { if (!confirmStudioNavigation()) return false; discardCurrentStudioDraft(); }
  studioWorkspace.creating = "";
  resetContentForm();
  if (kind === "section") editSection(item); else editSubsection(item);
  rememberStudioBoard(); setArticlePanelVisible("editor", true); renderContentStructureNav();
  if (!force && matchMedia("(max-width:1050px)").matches) document.querySelector(".content-selection-header").scrollIntoView?.({ block: "start", behavior: "smooth" });
  return true;
}
function enterStudioContentCategory(kind) {
  if (!["content", "gallery", "resources"].includes(kind)) return false;
  if (app.currentView === "sections") {
    if (kind === studioSectionCategory) return true;
    if (!confirmStudioNavigation()) return false;
    rememberStudioBoard(); discardCurrentStudioDraft();
  }
  if (!switchView("sections")) return false;
  studioSectionCategory = kind; studioWorkspace.creating = ""; studioWorkspace.query = "";
  document.getElementById("content-board-search").value = "";
  document.getElementById("content-search").value = "";
  document.getElementById("content-list-status").value = "";
  resetSectionForm(); resetSubsectionForm(); setSectionEditorLevel("section"); resetContentForm();
  syncContentManagerMeta(); showInlineContentEditor();
  restoreStudioBoardSelection();
  return true;
}
function restoreStudioBoardSelection() {
  const saved = studioWorkspace.remembered[studioSectionCategory];
  const first = app.sections.filter(item => item.kind === studioSectionCategory).sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0))[0];
  if (!saved || !selectStudioBoard(saved.kind, saved.id, { force: true })) {
    if (first) selectStudioBoard("section", first.id, { force: true });
    else { setArticlePanelVisible("editor", true); renderContentStructureNav(); }
  }
}
function syncStudioWorkspaceHeader() {
  const board = currentStudioBoard(), creating = studioWorkspace.creating;
  const label = contentCategoryMeta().label;
  document.getElementById("content-manager-title").textContent = `${label}管理`;
  document.getElementById("side-content-title").textContent = `${label}板块`;
  document.querySelectorAll(".content-category-tabs [data-studio-category]").forEach(control => {
    control.classList.toggle("active", control.dataset.studioCategory === studioSectionCategory);
    control.setAttribute("aria-pressed", String(control.dataset.studioCategory === studioSectionCategory));
  });
  document.getElementById("content-selection-title").textContent = creating ? `新建${{ section: "大板块", subsection: "小板块", child: "小小板块" }[creating]}` : board?.item.name || "选择已有板块";
  const description = document.getElementById("content-selection-description");
  description.textContent = creating ? "填写名称与设置后保存，即可在目录中找到它。" : board ? `${board.kind === "section" ? "大板块" : board.item.parent_id ? "小小板块" : "小板块"} · ${visibilityLabels[board.item.visibility] || "公开"} · ${studioSectionCategory === "content" ? "文章列表包含已有下级板块中的文章" : "通过目录切换板块，管理图片、文件和上传"}` : "从左侧目录选择板块，或新建第一个大板块。";
  const breadcrumbs = document.getElementById("content-workspace-breadcrumb"); breadcrumbs.replaceChildren();
  const category = document.createElement("span"); category.textContent = `网站内容 / ${label}`; breadcrumbs.append(category);
  if (board) {
    const path = [{ kind: "section", item: board.section }];
    if (board.kind === "subsection") {
      const parent = app.subsections.find(item => item.id === board.item.parent_id);
      if (parent) path.push({ kind: "subsection", item: parent }); path.push({ kind: "subsection", item: board.item });
    }
    for (const part of path) { const control = button(part.item.name, "breadcrumb-board"); control.addEventListener("click", () => selectStudioBoard(part.kind, part.item.id)); breadcrumbs.append(document.createTextNode(" / "), control); }
  }
  for (const id of ["rename-current-board", "content-board-share"]) document.getElementById(id).disabled = !board || Boolean(creating);
  const available = Boolean(board || creating), empty = document.getElementById("content-workspace-empty");
  document.getElementById("content-manager-layout").hidden = !available;
  document.getElementById("content-panel-controls").hidden = !available;
  document.getElementById("content-editor-open").disabled = Boolean(creating);
  document.getElementById("content-panels-both").disabled = Boolean(creating);
  empty.hidden = available;
  const hasBoards = app.sections.some(item => item.kind === studioSectionCategory);
  document.getElementById("content-workspace-empty-text").textContent = studioWorkspace.status === "loading" ? "正在加载已有板块与内容…" : studioWorkspace.error ? `目录加载失败：${studioWorkspace.error}。请点击“刷新目录与内容”重试。` : hasBoards ? "请从目录选择一个已有板块，或新建大板块。" : `当前${label}分类还没有大板块。其他分类的内容可通过上方按钮查看。`;
  empty.querySelector("button").hidden = studioWorkspace.status === "loading" || Boolean(studioWorkspace.error);
  document.getElementById("content-workspace-refresh").disabled = studioWorkspace.status === "loading";
  syncStudioArticleEditor();
}
function renderStudioBoardCatalog() {
  syncArticlePanels(); syncStudioCreationControls();
  const host = document.getElementById("content-structure-nav"); host.replaceChildren();
  const sections = app.sections.filter(item => item.kind === studioSectionCategory).sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));
  const current = currentStudioBoard(), query = studioWorkspace.query.trim().toLocaleLowerCase();
  const count = sections.length + app.subsections.filter(item => sections.some(section => section.id === item.section_id)).length;
  document.getElementById("content-catalog-count").textContent = `${count} 个板块`;
  const status = document.getElementById("content-catalog-status");
  status.textContent = studioWorkspace.status === "loading" ? "正在加载已有目录…" : studioWorkspace.error ? `加载失败：${studioWorkspace.error}。可点击上方刷新重试。` : "大板块 → 小板块 → 小小板块";
  function control(kind, item, depth) {
    const row = button("", `structure-${kind === "section" ? "section" : "subsection"}${depth > 1 ? " is-child" : ""}`);
    row.dataset.boardKind = kind; row.dataset.boardId = item.id;
    row.style.setProperty("--board-depth", depth);
    const name = document.createElement("span"); name.className = "board-name"; name.textContent = item.name;
    const meta = document.createElement("small"); meta.textContent = depth === 0 ? "大板块" : depth === 1 ? "小板块" : "小小板块";
    row.append(name, meta); row.classList.toggle("active", !studioWorkspace.creating && current?.kind === kind && current.item.id === item.id);
    row.setAttribute("aria-current", current?.kind === kind && current.item.id === item.id && !studioWorkspace.creating ? "true" : "false");
    row.title = item.name; row.addEventListener("click", () => selectStudioBoard(kind, item.id)); return row;
  }
  for (const section of sections) {
    const children = app.subsections.filter(item => item.section_id === section.id).sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));
    const matches = new Set(children.filter(item => `${section.name} ${subsectionPath(item)}`.toLocaleLowerCase().includes(query)).map(item => item.id));
    for (const item of children) if (matches.has(item.id) && item.parent_id) matches.add(item.parent_id);
    if (query && !section.name.toLocaleLowerCase().includes(query) && !matches.size) continue;
    const group = document.createElement("div"); group.className = "structure-group"; group.append(control("section", section, 0));
    for (const parent of children.filter(item => !item.parent_id)) {
      if (query && !matches.has(parent.id)) continue;
      group.append(control("subsection", parent, 1));
      for (const child of children.filter(item => item.parent_id === parent.id)) if (!query || matches.has(child.id)) group.append(control("subsection", child, 2));
    }
    host.append(group);
  }
  if (!host.children.length) {
    const empty = document.createElement("p"); empty.className = "content-structure-empty";
    empty.textContent = query ? "没有匹配的板块。清空搜索或切换上方内容类型查看。" : studioWorkspace.status === "loading" ? "目录加载中…" : studioWorkspace.error ? "目录暂未加载，请刷新重试。" : "暂无板块，点击下方“新建板块”。";
    host.append(empty);
  }
  syncStudioWorkspaceHeader();
}
function renderStudioArticleList() {
  const host = document.getElementById("content-list"); host.replaceChildren();
  const board = currentStudioBoard(), descendants = studioBoardDescendants(board);
  const all = app.currentView === "sections" ? app.content.filter(item => studioBoardIncludes(board, item, descendants)) : app.content;
  const query = document.getElementById("content-search").value.trim().toLocaleLowerCase(), status = document.getElementById("content-list-status").value;
  const items = all.filter(item => (!query || `${item.title} ${item.excerpt || ""}`.toLocaleLowerCase().includes(query)) && (!status || item.status === status));
  document.getElementById("content-list-summary").textContent = `显示 ${items.length} / ${all.length} 篇文章（含草稿与下级板块）`;
  for (const item of items) {
    const row = button("", `list-item${document.getElementById("content-id").value === item.id ? " active" : ""}`);
    const title = document.createElement("span"); title.className = "list-title"; title.textContent = item.title;
    const meta = document.createElement("span"); meta.className = "list-meta";
    const sub = app.subsections.find(value => value.id === item.subsection_id);
    meta.textContent = `${item.status === "published" ? "已发布" : "草稿"} · ${sub ? subsectionPath(sub) : "大板块直属"} · ${visibilityLabels[item.visibility] || "公开"} · ${formatDate(item.updated_at)}`;
    row.append(title, meta); row.addEventListener("click", () => openStudioArticle(item)); host.append(row);
  }
  if (!items.length) { const empty = document.createElement("p"); empty.className = "status"; empty.textContent = all.length ? "没有匹配的文章，可清空搜索或选择全部状态。" : "此板块还没有文章，点击“新建文章”开始写作。"; host.append(empty); }
  syncStudioArticleEditor();
}
function syncStudioArticleEditor() {
  document.getElementById("content-form").hidden = !studioWorkspace.articleOpen;
  document.getElementById("content-document-empty").hidden = studioWorkspace.articleOpen;
  document.querySelector(".article-workspace").classList.toggle("is-editing", studioWorkspace.articleOpen);
  document.getElementById("content-document-title").textContent = document.getElementById("content-id").value ? "编辑文章" : "新建文章";
}
function openStudioArticle(item) {
  if (document.getElementById("content-id").value === item.id && studioWorkspace.articleOpen) return;
  const board = currentStudioBoard();
  if (!confirmStudioNavigation()) return;
  discardCurrentStudioDraft();
  if (board) selectStudioBoard(board.kind, board.item.id, { force: true });
  setArticlePanelVisible("editor", true); editContent(item);
  document.getElementById("content-document-pane").scrollIntoView?.({ block: "start", behavior: "smooth" });
}
function startStudioArticle() {
  const board = currentStudioBoard();
  if (!board || studioWorkspace.creating) { alert("请先从目录选择一个已保存的文章板块。"); return; }
  if (!confirmStudioNavigation()) return;
  discardCurrentStudioDraft(); selectStudioBoard(board.kind, board.item.id, { force: true });
  resetContentForm({ open: true }); document.getElementById("content-title").focus();
}
function handleStudioScopeChoice(prefix, field) {
  const category = prefix === "media" ? "gallery" : "resources";
  if (app.currentView !== "sections" || studioSectionCategory !== category) return false;
  const sectionId = document.getElementById(`${prefix}-section`).value;
  if (!app.sections.some(item => item.id === sectionId && item.kind === category)) return false;
  const previous = currentStudioBoard();
  const subsectionId = field === "section" ? "" : document.getElementById(`${prefix}-subsection`).value;
  if (!selectStudioBoard(subsectionId ? "subsection" : "section", subsectionId || sectionId) && previous) {
    document.getElementById(`${prefix}-section`).value = previous.section.id;
    document.getElementById(`${prefix}-subsection`).value = previous.kind === "subsection" ? previous.item.id : "";
  }
  return true;
}
async function loadStudioContentData({ initial = false } = {}) {
  if (studioWorkspace.loading) return studioWorkspace.loading;
  if (!initial) { if (!confirmStudioNavigation()) return false; rememberStudioBoard(); discardCurrentStudioDraft(); }
  studioWorkspace.status = "loading"; studioWorkspace.error = ""; renderContentStructureNav();
  studioWorkspace.loading = (async () => {
    try {
      await loadUsers();
      const results = await Promise.allSettled([loadSections(), loadSubsections(), loadContent(), loadAlbumsAndMedia(), loadAssets()]);
      const failure = results.find(result => result.status === "rejected"); if (failure) throw failure.reason;
      studioWorkspace.status = "ready";
      if (app.currentView === "sections" && !hasStudioWorkInProgress() && !studioWorkspace.creating) restoreStudioBoardSelection();
      return true;
    } catch (error) { studioWorkspace.status = "error"; studioWorkspace.error = error.message || "网络连接失败"; return false; }
    finally { studioWorkspace.loading = null; renderContentStructureNav(); renderContentList(); }
  })();
  return studioWorkspace.loading;
}
function initializeStudioContentWorkspace() {
  document.getElementById("content-board-search").addEventListener("input", event => { studioWorkspace.query = event.target.value; renderContentStructureNav(); });
  document.getElementById("content-search").addEventListener("input", renderContentList);
  document.getElementById("content-list-status").addEventListener("change", renderContentList);
  document.getElementById("content-workspace-refresh").addEventListener("click", () => loadStudioContentData());
  document.getElementById("content-panels-both").addEventListener("click", () => { articlePanelVisibility.settings = articlePanelVisibility.editor = true; syncArticlePanels(); });
  document.getElementById("content-board-share").addEventListener("click", () => { const board = currentStudioBoard(); if (board) openStudioShare(board.kind, board.item); });
  document.getElementById("content-document-close").addEventListener("click", () => {
    const form = document.getElementById("content-form");
    if (studioDirtyForms.has(form) && !confirm("文章修改尚未保存，确定返回列表并放弃这些修改吗？")) return;
    resetContentForm();
  });
}
