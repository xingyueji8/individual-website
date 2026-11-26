/* =========================================================
       R2 大文件分片上传与文件夹管理
       ---------------------------------------------------------
       每个文件按服务器返回的 partSize 切片上传。某一片网络失败会自动重试
       六次；只有所有片的 ETag 都返回后才请求 R2 合并，避免出现半个文件。
       ========================================================= */
function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = bytes;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
}
function formatUploadRate(value) {
  const bytesPerSecond = Number(value) || 0;
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "--";
}
function assetFolderPath(id) {
  if (!id) return "根目录";
  const map = new Map(app.assetFolders.map((item) => [item.id, item]));
  const names = [];
  const seen = new Set();
  let cursor = map.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parent_id ? map.get(cursor.parent_id) : null;
  }
  return names.join(" / ") || "未知目录";
}
async function loadAssets() {
  [app.assetFolders, app.assets] = await Promise.all([
    api("/api/admin/asset-folders"),
    api("/api/admin/assets")
  ]);
  if (app.currentAssetFolder && !app.assetFolders.some((item) => item.id === app.currentAssetFolder))
    app.currentAssetFolder = "";
  fillAssetSections();
  refreshAssetSubsectionOptions();
  renderAssetFolderOptions();
  renderAssetBrowser();
  renderResourcePicker();
  renderArticleAssets();
  renderContentSectionAssets();
  renderMedia();
  renderRecoveredUploadCards();
}
function renderAssetFolderOptions() {
  const select = document.getElementById("asset-current-folder");
  const current = app.currentAssetFolder;
  clear(select);
  const root = document.createElement("option");
  root.value = "";
  root.textContent = "根目录";
  select.append(root);
  app.assetFolders
    .filter((item) => (item.section_id || "section-resources") === currentAssetSection())
    .sort((a, b) => assetFolderPath(a.id).localeCompare(assetFolderPath(b.id), "zh-CN"))
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = assetFolderPath(item.id);
      select.append(option);
    });
  select.value = current;
}
function renderAssetBrowser() {
  syncAssetBoardShareControl();
  const browser = document.getElementById("asset-browser");
  clear(browser);
  const current = app.currentAssetFolder || null;
  const subsectionId = document.getElementById("asset-subsection").value || null;
  const folders = app.assetFolders.filter(
    (item) =>
      (item.section_id || "section-resources") === currentAssetSection() &&
      (item.parent_id || null) === current
  );
  const assets = app.assets.filter(
    (item) =>
      item.scope !== "article" &&
      item.section_id === currentAssetSection() &&
      (item.folder_id || null) === current &&
      (item.subsection_id || null) === subsectionId
  );
  const photos = [];
  if (current) {
    const folder = app.assetFolders.find((item) => item.id === current);
    const up = document.createElement("div");
    up.className = "asset-row folder";
    const copy = document.createElement("div");
    copy.className = "asset-row-title";
    const strong = document.createElement("strong");
    strong.textContent = `↩ 返回 ${folder?.parent_id ? assetFolderPath(folder.parent_id) : "根目录"}`;
    copy.append(strong);
    up.append(copy);
    up.addEventListener("click", () => {
      app.currentAssetFolder = folder?.parent_id || "";
      renderAssetFolderOptions();
      renderAssetBrowser();
    });
    browser.append(up);
  }
  folders.forEach((folder) => {
    const row = document.createElement("article");
    row.className = "asset-row folder";
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "asset-row-title";
    const name = document.createElement("strong");
    name.textContent = `📁 ${folder.name}`;
    title.append(name);
    const meta = document.createElement("div");
    meta.className = "asset-row-meta";
    meta.textContent = `${visibilityLabels[folder.visibility] || "公开"} · 子文件夹 ${folder.folder_count || 0} · 文件 ${folder.asset_count || 0}${folder.description ? ` · ${folder.description}` : ""}`;
    info.append(title, meta);
    const controls = document.createElement("div");
    controls.className = "asset-row-controls";
    const open = button("打开");
    open.addEventListener("click", () => {
      app.currentAssetFolder = folder.id;
      renderAssetFolderOptions();
      renderAssetBrowser();
    });
    const edit = button("编辑");
    edit.addEventListener("click", () => editAssetFolder(folder));
    const archive = button(folder.archive_asset_id ? "更换整包" : "设置整包下载");
    archive.addEventListener("click", () => attachFolderArchive(folder));
    const del = button("删除", "btn small danger");
    del.addEventListener("click", () => deleteAssetFolder(folder));
    controls.append(open, edit, archive, contentSecurityButton("assetFolder", folder), del);
    row.append(info, controls);
    browser.append(row);
  });
  photos.forEach((item) => browser.append(createManagedPhotoRow(item)));
  assets.forEach((item) => browser.append(createAssetRow(item)));
  if (!folders.length && !assets.length && !photos.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "这个小板块和文件夹还是空的。";
    browser.append(empty);
  }
}
function createManagedPhotoRow(item) {
  const row = document.createElement("article");
  row.className = "asset-row";
  const info = document.createElement("div");
  const title = document.createElement("div");
  title.className = "asset-row-title";
  const image = document.createElement("img");
  image.src = `/api/admin/media/${item.id}/source?preview=1`;
  image.alt = item.caption || item.filename;
  image.style.cssText =
    "width:58px;height:44px;object-fit:cover;border-radius:10px;margin-right:10px;vertical-align:middle";
  const name = document.createElement("strong");
  name.textContent = item.caption || item.filename;
  title.append(image, name);
  const meta = document.createElement("div");
  meta.className = "asset-row-meta";
  meta.textContent = `图片 · ${visibilityLabels[item.visibility] || "公开"}`;
  info.append(title, meta);
  const controls = document.createElement("div");
  controls.className = "asset-row-controls";
  const preview = button("预览");
  preview.addEventListener("click", () =>
    window.open(`/api/admin/media/${item.id}/source?preview=1`, "_blank", "noopener")
  );
  const download = button("下载原图");
  download.addEventListener("click", () =>
    window.open(`/api/admin/media/${item.id}/source?download=1`, "_blank", "noopener")
  );
  const permission = button("保存权限");
  permission.addEventListener("click", () => editManagedPhotoVisibility(item));
  const del = button("删除", "btn small danger");
  del.addEventListener("click", () => deleteMedia(item));
  controls.append(preview, download, permission, del);
  row.append(info, controls);
  return row;
}
function createAssetRow(item) {
  const row = document.createElement("article");
  row.className = "asset-row";
  const info = document.createElement("div");
  const title = document.createElement("div");
  title.className = "asset-row-title";
  const name = document.createElement("strong");
  name.textContent = `${item.kind === "video" ? "🎬" : item.kind === "archive" ? "🗜️" : item.kind === "pdf" || item.kind === "word" ? "📄" : "📦"} ${item.display_name}`;
  title.append(name);
  const primaryUpload = (item.uploads || []).find((upload) => !upload.variant_label);
  const variantUpload = (item.uploads || []).find((upload) => upload.variant_label);
  const labels = (item.variants || [])
    .filter((v) => v.status === "ready")
    .map((v) => v.label)
    .join("、");
  const meta = document.createElement("div");
  meta.className = "asset-row-meta";
  if (primaryUpload) {
    meta.textContent = `上传未完成 · 已确认 ${formatBytes(primaryUpload.uploaded_size)} / ${formatBytes(primaryUpload.expected_size)} · 刷新不会删除已确认分片`;
  } else if (item.status === "failed") {
    meta.textContent = "上传失败或会话已结束 · 这个未完成记录可以删除后重新上传";
  } else {
    meta.textContent = `${item.kind.toUpperCase()} · ${formatBytes(item.size_bytes)} · ${visibilityLabels[item.visibility] || item.visibility} · ${item.download_policy === "public" ? "游客可下载" : "仅审核用户可下载"}${labels ? ` · 版本：${labels}` : ""}${variantUpload ? ` · ${variantUpload.variant_label} 已确认 ${formatBytes(variantUpload.uploaded_size)} / ${formatBytes(variantUpload.expected_size)}` : ""}${item.note ? ` · 备注：${item.note}` : ""}`;
  }
  info.append(title, meta);
  const controls = document.createElement("div");
  controls.className = "asset-row-controls";
  if (primaryUpload) {
    const resumeUpload = button("选择原文件继续");
    resumeUpload.addEventListener("click", () => selectFileForRecoveredUpload(item, primaryUpload));
    const cancelUpload = button("取消并删除", "btn small danger");
    cancelUpload.addEventListener("click", () =>
      cancelPendingAssetUpload(item, primaryUpload, cancelUpload)
    );
    controls.append(resumeUpload, cancelUpload);
    row.append(info, controls);
    return row;
  }
  if (item.status !== "ready") {
    const delFailed = button("删除未完成记录", "btn small danger");
    delFailed.addEventListener("click", () => deleteAsset(item));
    controls.append(delFailed);
    row.append(info, controls);
    return row;
  }
  const download = document.createElement("select");
  [
    ["member", "登录后下载"],
    ["public", "游客可下载"]
  ].forEach(([value, text]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    download.append(o);
  });
  download.value = item.download_policy;
  const save = button("保存权限");
  save.addEventListener("click", async () => {
    const choice = await openVisibilityEditor(
      `设置“${item.display_name}”的权限`,
      item.visibility,
      item.allowed_user_ids || []
    );
    if (!choice) return;
    await saveAssetMetadata(item, { ...choice, downloadPolicy: download.value });
  });
  const open = button(item.kind === "archive" ? "下载测试" : "预览");
  open.addEventListener("click", () =>
    window.open(item.kind === "archive" ? item.downloadUrl : item.url, "_blank", "noopener")
  );
  controls.append(
    download,
    save,
    open,
    studioShareButton("asset", item),
    contentSecurityButton("asset", item)
  );
  if (item.kind === "video") {
    const variant = button("上传清晰度");
    variant.addEventListener("click", () => chooseAssetVariant(item));
    controls.append(variant);
    const stream = button(item.stream_hls_url ? "修改自动流" : "接入自动画质");
    stream.addEventListener("click", () => configureVideoStream(item));
    controls.append(stream);
    const poster = button(item.poster_url ? "更换视频封面" : "上传视频封面");
    poster.addEventListener("click", () => {
      app.posterTarget = item;
      document.getElementById("asset-poster-input").click();
    });
    controls.append(poster);
  }
  if (item.kind === "word") {
    const preview = button("上传 PDF 预览");
    preview.addEventListener("click", () => chooseAssetVariant(item, "preview"));
    controls.append(preview);
  }
  const rename = button("改名");
  rename.addEventListener("click", () => renameAsset(item));
  const note = button("编辑备注");
  note.addEventListener("click", () => editAssetNote(item));
  const del = button("删除", "btn small danger");
  del.addEventListener("click", () => deleteAsset(item));
  controls.append(rename, note, del);
  row.append(info, controls);
  return row;
}
async function editAssetFolder(folder) {
  const name = prompt("文件夹名称", folder.name);
  if (name === null || !name.trim()) return;
  const description = prompt("文件夹说明（选填）", folder.description || "");
  if (description === null) return;
  const choice = await openVisibilityEditor(
    `设置文件夹“${name}”的权限`,
    folder.visibility,
    folder.allowed_user_ids || []
  );
  if (!choice) return;
  await api(`/api/admin/asset-folders/${folder.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      parentId: folder.parent_id,
      ...choice,
      sortOrder: folder.sort_order,
      archiveAssetId: folder.archive_asset_id
    })
  });
  await loadAssets();
}
async function attachFolderArchive(folder) {
  const archives = app.assets.filter(
    (item) =>
      item.scope === "library" &&
      item.section_id === (folder.section_id || "section-resources") &&
      item.kind === "archive" &&
      item.status === "ready"
  );
  if (!archives.length) {
    alert("请先上传一个 ZIP、7z 或 RAR 压缩包，再把它设为该文件夹的整包下载。");
    return;
  }
  const choices = archives.map((item, index) => `${index + 1}. ${item.display_name}`).join("\n");
  const answer = prompt(
    `输入压缩包前面的序号；输入 0 可取消整包关联：\n\n${choices}`,
    folder.archive_asset_id
      ? String(Math.max(0, archives.findIndex((item) => item.id === folder.archive_asset_id) + 1))
      : "1"
  );
  if (answer === null) return;
  const number = Number(answer);
  if (!Number.isInteger(number) || number < 0 || number > archives.length) {
    alert("序号无效");
    return;
  }
  await api(`/api/admin/asset-folders/${folder.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folder.name,
      description: folder.description,
      parentId: folder.parent_id,
      visibility: folder.visibility,
      allowedUserIds: folder.allowed_user_ids || [],
      sortOrder: folder.sort_order,
      archiveAssetId: number ? archives[number - 1].id : null
    })
  });
  await loadAssets();
}
async function deleteAssetFolder(folder) {
  if (!confirm(`确定删除空文件夹“${folder.name}”吗？`)) return;
  try {
    await api(`/api/admin/asset-folders/${folder.id}`, { method: "DELETE" });
    await loadAssets();
  } catch (error) {
    alert(error.message);
  }
}
async function saveAssetMetadata(item, changes) {
  const merged = {
    visibility: item.visibility,
    allowedUserIds: item.allowed_user_ids || [],
    ...changes
  };
  await api(`/api/admin/assets/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(merged)
  });
  document.getElementById("asset-notice").textContent = "文件设置已保存。";
  await loadAssets();
}
async function editAssetVisibility(item) {
  const choice = await openVisibilityEditor(
    `设置“${item.display_name}”的权限`,
    item.visibility,
    item.allowed_user_ids || []
  );
  if (choice) await saveAssetMetadata(item, choice);
}
async function renameAsset(item) {
  const displayName = prompt("网站中显示的名称", item.display_name);
  if (displayName === null || !displayName.trim()) return;
  await saveAssetMetadata(item, { displayName });
}
async function editAssetNote(item) {
  const note = prompt("文件备注（可留空）", item.note || "");
  if (note === null) return;
  await saveAssetMetadata(item, { note });
}
async function configureVideoStream(item) {
  const streamHlsUrl = prompt(
    "粘贴 Cloudflare Stream 的 HLS (.m3u8) 地址；留空可取消自动画质",
    item.stream_hls_url || ""
  );
  if (streamHlsUrl === null) return;
  await saveAssetMetadata(item, { streamHlsUrl: streamHlsUrl.trim() });
}
async function deleteAsset(item) {
  if (!confirm(`确定永久删除“${item.display_name}”及其全部清晰度/预览版本吗？`)) return;
  await api(`/api/admin/assets/${item.id}`, { method: "DELETE" });
  await Promise.all([loadAssets(), loadDashboard()]);
}
