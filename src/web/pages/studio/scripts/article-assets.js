function chooseAssetVariant(item, fixedLabel = "") {
  let label = fixedLabel;
  if (!label) {
    label = prompt("输入视频版本：360p / 480p / 720p / 1080p", "720p") || "";
    if (!["360p", "480p", "720p", "1080p"].includes(label)) {
      if (label) alert("清晰度只能是 360p、480p、720p 或 1080p");
      return;
    }
  }
  app.variantTarget = { item, label };
  const input = document.getElementById("asset-variant-input");
  input.accept = label === "preview" ? "application/pdf" : "video/mp4,video/webm";
  input.click();
}

function renderResourcePicker() {
  const list = document.getElementById("resource-picker-list");
  if (!list) return;
  clear(list);
  const add = (type, id, label, meta) => {
    const row = document.createElement("div");
    row.className = "resource-picker-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = label;
    const small = document.createElement("div");
    small.className = "list-meta";
    small.textContent = meta;
    copy.append(title, small);
    const insert = button("插入正文", "btn small");
    insert.addEventListener("click", () => insertResourceEmbed(type, id, label));
    row.append(copy, insert);
    list.append(row);
  };
  const contentId = document.getElementById("content-id").value;
  app.assets
    .filter(
      (item) => item.scope === "article" && item.content_id === contentId && item.status === "ready"
    )
    .forEach((item) =>
      add(
        "asset",
        item.id,
        `${item.kind === "video" ? "🎬" : "📄"} ${item.display_name}`,
        `${item.kind.toUpperCase()} · ${formatBytes(item.size_bytes)}`
      )
    );
  if (!list.children.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "还没有可插入的文件。";
    list.append(p);
  }
}
function renderArticleAssets() {
  const host = document.getElementById("article-assets-list");
  if (!host) return;
  clear(host);
  const contentId = document.getElementById("content-id").value;
  const items = app.assets.filter((item) => item.scope === "article" && item.content_id === contentId);
  items.forEach((item) => host.append(createAssetRow(item)));
  const photos = app.media.filter((item) => item.kind === "inline" && item.content_id === contentId);
  photos.forEach((item) => {
    const row = createManagedPhotoRow(item);
    row.querySelector(".asset-row-controls").append(contentSecurityButton("media", item));
    host.append(row);
  });
  if (contentId && !items.length && !photos.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "这篇文章还没有上传附件。";
    host.append(empty);
  }
}
function renderContentSectionAssets() {
  const host = document.getElementById("content-section-assets-list");
  if (!host) return;
  clear(host);
  const sectionId = document.getElementById("content-section")?.value;
  const subsectionId = document.getElementById("content-subsection")?.value || null;
  if (!sectionId) return;
  const photos = app.media.filter(
    (item) =>
      item.kind === "photo" &&
      item.section_id === sectionId &&
      (item.subsection_id || null) === subsectionId
  );
  const assets = app.assets.filter(
    (item) =>
      item.scope === "section" &&
      item.section_id === sectionId &&
      (item.subsection_id || null) === subsectionId
  );
  photos.forEach((item) => host.append(createManagedPhotoRow(item)));
  assets.forEach((item) => host.append(createAssetRow(item)));
  if (!photos.length && !assets.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "当前文章大板块的小板块还没有独立图片或文件。";
    host.append(empty);
  }
}
function insertResourceEmbed(type, id, label) {
  const editor = document.getElementById("content-editor");
  editor.focus();
  const selection = getSelection();
  if (app.editorRange) {
    selection.removeAllRanges();
    selection.addRange(app.editorRange);
  }
  const embed = document.createElement("div");
  embed.className = "resource-embed";
  embed.dataset.resourceType = type;
  embed.dataset.resourceId = id;
  embed.textContent = `已插入：${label}`;
  if (selection.rangeCount) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(embed);
    range.setStartAfter(embed);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else editor.append(embed);
  if (type === "asset") app.articleSessionAssetIds.add(id);
  document.getElementById("resource-picker").close();
  document.getElementById("content-notice").textContent = "资源已插入正文，保存文章后生效。";
}
