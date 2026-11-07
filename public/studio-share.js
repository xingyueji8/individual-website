/* Sharing opens only saved works. Copy is the explicit permission change. */
function studioShareButton(kind, item, label = "分享") {
  const control = button(label);
  control.dataset.shareKind = kind;
  control.dataset.shareId = item.id;
  control.addEventListener("click", () => openStudioShare(kind, item));
  return control;
}
function assetBoardShareTarget() {
  const sectionId = document.getElementById("asset-section").value;
  const subsectionId = document.getElementById("asset-subsection").value;
  if (subsectionId) return { kind: "subsection", item: app.subsections.find(item => item.id === subsectionId && item.section_id === sectionId) };
  return { kind: "section", item: app.sections.find(item => item.id === sectionId) };
}
function syncAssetBoardShareControl() {
  const control = document.getElementById("asset-share-board");
  const { item, kind } = assetBoardShareTarget();
  const level = kind === "section" ? "大板块" : item?.parent_id ? "小小板块" : "小板块";
  control.textContent = `分享当前${level}`;
  control.title = item ? `分享${level}「${item.name}」及其已有下级和作品` : "请先选择一个已保存的文件板块";
  control.setAttribute("aria-label", control.title);
}
function openStudioAssetBoardShare() {
  const { kind, item } = assetBoardShareTarget();
  if (!item) { alert("请先选择一个已保存的文件大板块或小板块；若原板块已删除，请刷新后重新选择。"); return; }
  openStudioShare(kind, item);
}

async function copyStudioShareLink(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("浏览器未允许复制，请开启剪贴板权限后重试");
}

function reflectSharePermissions(targets, allowDownload) {
  const collections = { section: app.sections, content: app.content, media: app.media, asset: app.assets, subsection: app.subsections };
  for (const target of targets || []) {
    const item = collections[target.kind]?.find(item => item.id === target.id);
    if (item) { item.visibility = "public"; item.allowed_user_ids = []; if (allowDownload) item.download_policy = "public"; }
    if (item && target.kind === "asset") item.access_mode = "public";
  }
  for (const kind of ["section", "content", "subsection"]) {
    const id = document.getElementById(`${kind}-id`).value;
    if (!targets?.some(target => target.kind === kind && target.id === id)) continue;
    document.getElementById(`${kind}-visibility`).value = "public";
    syncAudiencePicker(`${kind}-visibility`, `${kind}-user-picker`, []);
    if (allowDownload && kind === "subsection") document.getElementById("subsection-download-policy").value = "public";
  }
  renderContentList(); renderSectionList(); renderSubsectionList(); renderContentStructureNav();
  renderMedia(); renderAlbums(); renderAssetBrowser(); renderArticleAssets();
}

function openStudioShare(kind, item) {
  if (!item?.id) { alert("请先保存作品或板块，再分享。"); return; }
  if (activeStudioDirtyForms().length || document.querySelector(".media-card.is-editing")) {
    alert("请先保存当前修改，再复制分享链接。"); return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "resource-picker studio-share-dialog";
  dialog.setAttribute("aria-label", "分享作品或板块");
  const heading = document.createElement("h2"); heading.textContent = "分享浏览链接";
  const help = document.createElement("p"); help.className = "status";
  help.textContent = "复制成功后，所选作品将开放给所有人浏览，并解除其内容锁。默认仅在线浏览，不开放原内容的下载权限；勾选下方选项才会同时开放下载。收回浏览权限或重新上锁后，链接失效；允许下载的链接在收回下载权限后也会失效。";
  if (kind === "section" || kind === "subsection") help.textContent = "分享范围为整个选中板块及其已有下级和文件夹中的作品。" + help.textContent;
  const choices = document.createElement("div"); choices.className = "actions";
  const downloadOption = document.createElement("label"); downloadOption.className = "check-row";
  const download = document.createElement("input"); download.type = "checkbox"; download.name = "allowDownload"; download.checked = false;
  downloadOption.append(download, document.createTextNode("允许通过此链接下载原图、文件及导出文章"));
  const detail = document.createElement("p"); detail.className = "status";
  const notice = document.createElement("p"); notice.className = "status"; notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
  const controls = document.createElement("div"); controls.className = "actions";
  const copy = button("复制分享链接", "btn"); copy.disabled = true;
  const close = button("关闭", "btn ghost"); close.addEventListener("click", () => dialog.close());
  controls.append(copy, close);
  dialog.append(heading, help, choices, downloadOption, detail, controls, notice);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  const options = [{ kind, id: item.id, label: { content: "分享这篇文章", media: "分享这张图片", asset: "分享这个文件／视频", section: "分享这个大板块", subsection: item.parent_id ? "分享这个小小板块" : "分享这个小板块" }[kind] }];
  const subsection = app.subsections.find(section => section.id === item.subsection_id);
  if (kind !== "subsection" && subsection) options.push({ kind: "subsection", id: subsection.id, label: `分享小板块「${subsection.name}」` });
  let prepared = null, generation = 0, busy = false, selectedOption, selectedControl;
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  async function select(option, control) {
    selectedOption = option; selectedControl = control;
    const current = ++generation;
    prepared = null; copy.disabled = true;
    choices.querySelectorAll("button").forEach(button => { button.classList.toggle("active", button === control); button.setAttribute("aria-pressed", String(button === control)); });
    detail.textContent = "正在读取已保存的分享范围…"; notice.textContent = "";
    try {
      const result = await api("/api/admin/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: option.kind, id: option.id, allowDownload: download.checked }) });
      if (current !== generation || !dialog.open) return;
      if (result.allowDownload !== download.checked) throw new Error("分享权限状态未同步，请刷新 Studio 后重试。");
      prepared = result;
      const summary = result.summary;
      detail.textContent = `「${result.title}」：${summary.content} 篇已发布文章、${summary.media} 张图片（含文章插图）、${summary.asset} 个文件／视频。${result.allowDownload ? "允许浏览和下载。" : "仅在线浏览，不提供下载。"}板块分享不含草稿、未完成上传及以后新增的作品。`;
      copy.disabled = false; copy.textContent = "复制分享链接";
    } catch (error) { if (current === generation) detail.textContent = error.message; }
  }
  download.addEventListener("change", () => { if (!busy && selectedOption) select(selectedOption, selectedControl); });
  for (const option of options) {
    const control = button(option.label); control.setAttribute("aria-pressed", "false");
    control.addEventListener("click", () => { if (!busy) select(option, control); });
    choices.append(control);
  }
  copy.addEventListener("click", async () => {
    if (!prepared || busy) return;
    busy = true; copy.disabled = true; close.disabled = true; download.disabled = true;
    choices.querySelectorAll("button").forEach(button => { button.disabled = true; });
    const selected = prepared;
    let copied = false;
    try {
      // This call stays inside the click gesture, before any network await.
      await copyStudioShareLink(selected.url); copied = true;
      notice.textContent = selected.allowDownload ? "链接已复制，正在开放浏览和下载权限…" : "链接已复制，正在开放在线浏览权限…";
      const result = await api(`/api/admin/shares/${selected.token}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      reflectSharePermissions(result.targets, result.allowDownload);
      notice.textContent = `分享链接已复制并生效。${result.allowDownload ? "对方可直接浏览和下载" : "对方仅可在线浏览，未开放下载"}；访问其他板块或功能会提示注册／登录。`;
      copy.textContent = "再次复制链接";
    } catch (error) {
      notice.textContent = copied ? `链接已复制，但未能确认权限开放成功：${error.message}。请重试确认生效；未生效的链接无法浏览。` : `复制失败：${error.message}。作品权限未改变。`;
    } finally {
      busy = false; copy.disabled = false; close.disabled = false; download.disabled = false;
      choices.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  });
  select(options[0], choices.firstElementChild);
}

function openStudioBoardRename(fromAssets = false) {
  const kind = fromAssets ? assetBoardShareTarget().kind : app.sectionEditorLevel === "subsection" ? "subsection" : "section";
  const item = fromAssets ? assetBoardShareTarget().item : (kind === "section" ? app.sections : app.subsections).find(value => value.id === document.getElementById(`${kind}-id`).value);
  if (!item) { alert("请先选择一个已保存的板块；新建板块请先填写名称并保存。"); return; }
  if (activeStudioDirtyForms().length || document.querySelector(".media-card.is-editing")) { alert("请先保存当前修改，再重命名板块。"); return; }
  const dialog = document.createElement("dialog"); dialog.className = "resource-picker studio-rename-dialog"; dialog.setAttribute("aria-label", "重命名板块");
  const form = document.createElement("form"), heading = document.createElement("h2");
  const level = kind === "section" ? "大板块" : item.parent_id ? "小小板块" : "小板块";
  heading.textContent = `重命名${level}`;
  const label = document.createElement("label"); label.className = "field"; label.textContent = "板块名称";
  const input = document.createElement("input"); input.name = "boardName"; input.maxLength = 80; input.required = true; input.value = item.name; label.append(input);
  const controls = document.createElement("div"); controls.className = "actions";
  const save = button("保存名称", "btn"); save.type = "submit";
  const cancel = button("取消", "btn ghost"); cancel.addEventListener("click", () => dialog.close()); controls.append(save, cancel);
  const notice = document.createElement("p"); notice.className = "status"; notice.setAttribute("role", "status");
  form.append(heading, label, controls, notice); dialog.append(form); document.body.append(dialog);
  let busy = false;
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const name = input.value.trim();
    if (!name || name.length > 80) { notice.textContent = "请输入 1–80 个字符的板块名称。"; return; }
    busy = true; save.disabled = cancel.disabled = input.disabled = true; notice.textContent = "正在保存名称…";
    try {
      const result = await api(`/api/admin/${kind === "section" ? "sections" : "subsections"}/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      Object.assign(item, { name: result.name, updated_at: result.updated_at });
      if (document.getElementById(`${kind}-id`).value === item.id) document.getElementById(`${kind}-name`).value = result.name;
      // Refresh labels while preserving board selections, the current folder,
      // and any article currently open in the editor.
      refreshSectionOptions(); renderSectionList(); renderSubsectionList(); renderContentStructureNav();
      renderContentList(); renderAlbums(); renderMedia(); renderAssetBrowser();
      const selectedKind = app.sectionEditorLevel === "subsection" ? "subsection" : "section";
      const selected = (selectedKind === "section" ? app.sections : app.subsections).find(value => value.id === document.getElementById(`${selectedKind}-id`).value);
      const section = selectedKind === "section" ? selected : app.sections.find(value => value.id === selected?.section_id);
      if (section) document.getElementById("content-inline-scope").textContent = selectedKind === "subsection" ? `${section.name} / ${selected.name}` : `${section.name} / 全部内容`;
      document.getElementById(fromAssets ? "asset-notice" : `${kind}-notice`).textContent = `已重命名为「${result.name}」`;
      dialog.close();
    } catch (error) { notice.textContent = error.message; }
    finally { busy = false; save.disabled = cancel.disabled = input.disabled = false; }
  });
  dialog.showModal(); input.focus(); input.select();
}
