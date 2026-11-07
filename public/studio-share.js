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

function reflectSharePermissions(targets) {
  const collections = { section: app.sections, content: app.content, media: app.media, asset: app.assets, subsection: app.subsections };
  for (const target of targets || []) {
    const item = collections[target.kind]?.find(item => item.id === target.id);
    if (item) { item.visibility = "public"; item.download_policy = "public"; item.allowed_user_ids = []; }
    if (item && target.kind === "asset") item.access_mode = "public";
  }
  for (const kind of ["section", "content", "subsection"]) {
    const id = document.getElementById(`${kind}-id`).value;
    if (!targets?.some(target => target.kind === kind && target.id === id)) continue;
    document.getElementById(`${kind}-visibility`).value = "public";
    syncAudiencePicker(`${kind}-visibility`, `${kind}-user-picker`, []);
    if (kind === "subsection") document.getElementById("subsection-download-policy").value = "public";
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
  help.textContent = "复制成功后，所选范围内的作品将开放给所有人浏览和下载，并解除其内容锁。以后修改浏览／下载权限或重新上锁，旧链接立即失效。上级板块与站内其他内容仍按原权限访问。";
  if (kind === "section" || kind === "subsection") help.textContent = "分享范围为整个选中板块及其已有下级和文件夹中的作品。" + help.textContent;
  const choices = document.createElement("div"); choices.className = "actions";
  const detail = document.createElement("p"); detail.className = "status";
  const notice = document.createElement("p"); notice.className = "status"; notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
  const controls = document.createElement("div"); controls.className = "actions";
  const copy = button("复制分享链接", "btn"); copy.disabled = true;
  const close = button("关闭", "btn ghost"); close.addEventListener("click", () => dialog.close());
  controls.append(copy, close);
  dialog.append(heading, help, choices, detail, controls, notice);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  const options = [{ kind, id: item.id, label: { content: "分享这篇文章", media: "分享这张图片", asset: "分享这个文件／视频", section: "分享这个大板块", subsection: item.parent_id ? "分享这个小小板块" : "分享这个小板块" }[kind] }];
  const subsection = app.subsections.find(section => section.id === item.subsection_id);
  if (kind !== "subsection" && subsection) options.push({ kind: "subsection", id: subsection.id, label: `分享小板块「${subsection.name}」` });
  let prepared = null, generation = 0, busy = false;
  async function select(option, control) {
    const current = ++generation;
    prepared = null; copy.disabled = true;
    choices.querySelectorAll("button").forEach(button => { button.classList.toggle("active", button === control); button.setAttribute("aria-pressed", String(button === control)); });
    detail.textContent = "正在读取已保存的分享范围…"; notice.textContent = "";
    try {
      const result = await api("/api/admin/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: option.kind, id: option.id }) });
      if (current !== generation || !dialog.open) return;
      prepared = result;
      const summary = result.summary;
      detail.textContent = `「${result.title}」：${summary.content} 篇已发布文章、${summary.media} 张图片（含文章插图）、${summary.asset} 个文件／视频。板块分享包含当前已有的下级板块和作品，不含草稿、未完成上传及以后新增的作品。`;
      copy.disabled = false; copy.textContent = "复制分享链接";
    } catch (error) { if (current === generation) detail.textContent = error.message; }
  }
  for (const option of options) {
    const control = button(option.label); control.setAttribute("aria-pressed", "false");
    control.addEventListener("click", () => { if (!busy) select(option, control); });
    choices.append(control);
  }
  copy.addEventListener("click", async () => {
    if (!prepared || busy) return;
    busy = true; copy.disabled = true; close.disabled = true;
    choices.querySelectorAll("button").forEach(button => { button.disabled = true; });
    const selected = prepared;
    let copied = false;
    try {
      // This call stays inside the click gesture, before any network await.
      await copyStudioShareLink(selected.url); copied = true;
      notice.textContent = "链接已复制，正在开放所选作品的浏览和下载权限…";
      const result = await api(`/api/admin/shares/${selected.token}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      reflectSharePermissions(result.targets);
      notice.textContent = "分享链接已复制并生效。对方可直接浏览和下载；访问其他板块或功能会提示注册／登录。";
      copy.textContent = "再次复制链接";
    } catch (error) {
      notice.textContent = copied ? `链接已复制，但未能确认权限开放成功：${error.message}。请重试确认生效；未生效的链接无法浏览。` : `复制失败：${error.message}。作品权限未改变。`;
    } finally {
      busy = false; copy.disabled = false; close.disabled = false;
      choices.querySelectorAll("button").forEach(button => { button.disabled = false; });
    }
  });
  select(options[0], choices.firstElementChild);
}
