document.getElementById("media-section").addEventListener("change", () => {
  if (handleStudioScopeChoice("media", "section")) return;
  renderAlbums();
  renderMedia();
});
document.getElementById("media-subsection").addEventListener("change", (event) => {
  if (handleStudioScopeChoice("media", "subsection")) return;
  const uploadTarget = document.getElementById("media-album");
  if (
    event.target.value &&
    [...uploadTarget.options].some((option) => option.value === event.target.value)
  )
    uploadTarget.value = event.target.value;
  renderMedia();
});
document.getElementById("media-visibility").addEventListener("change", () => {
  const picker = document.getElementById("media-user-picker");
  picker.classList.toggle(
    "hidden",
    !visibilityUsesAudience(document.getElementById("media-visibility").value)
  );
});
document.getElementById("add-album").addEventListener("click", async () => {
  const sectionId = document.getElementById("media-section").value;
  if (!sectionId) {
    alert("请先新建一个图片类大板块");
    return;
  }
  const name = prompt("新图片小板块名称");
  if (!name) return;
  const description = prompt("小板块说明（选填，可留空）") || "";
  const parent = app.sections.find((item) => item.id === sectionId);
  const choice = await openVisibilityEditor(
    `设置小板块“${name}”的权限`,
    parent?.visibility || "public",
    parent?.allowed_user_ids || []
  );
  if (!choice) return;
  await api("/api/admin/subsections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, sectionId, ...choice })
  });
  await loadSubsections();
  renderAlbums();
});
document.getElementById("media-form").addEventListener("submit", submitPhotoUploads);
document.getElementById("asset-current-folder").addEventListener("change", (event) => {
  app.currentAssetFolder = event.target.value;
  renderAssetBrowser();
});
document.getElementById("asset-subsection").addEventListener("change", () => {
  if (!handleStudioScopeChoice("asset", "subsection")) renderAssetBrowser();
});
document
  .getElementById("asset-upload-visibility")
  .addEventListener("change", () =>
    syncAudiencePicker(
      "asset-upload-visibility",
      "asset-upload-user-picker",
      selectedAudienceIds("asset-upload-user-picker")
    )
  );
document.getElementById("asset-refresh").addEventListener("click", loadAssets);
document.getElementById("asset-new-folder").addEventListener("click", async () => {
  const name = prompt("新文件夹名称");
  if (!name || !name.trim()) return;
  const description = prompt("文件夹说明（选填）") || "";
  const choice = visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  await api("/api/admin/asset-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      sectionId: currentAssetSection(),
      parentId: app.currentAssetFolder || null,
      ...choice
    })
  });
  await loadAssets();
});
document.getElementById("asset-upload-file").addEventListener("click", () => {
  const choice = visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "library",
    sectionId: currentAssetSection(),
    subsectionId: document.getElementById("asset-subsection").value,
    note: document.getElementById("asset-upload-note").value,
    ...choice
  };
  document.getElementById("asset-file-input").click();
});
document.getElementById("asset-upload-photo").addEventListener("click", () => {
  const choice = visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "library-photo",
    sectionId: "section-resources",
    subsectionId: document.getElementById("asset-subsection").value,
    ...choice
  };
  document.getElementById("asset-photo-input").click();
});
document.getElementById("media-upload-video").addEventListener("click", () => {
  const sectionId = document.getElementById("media-section").value;
  if (!sectionId) {
    alert("请先选择图片类大板块");
    return;
  }
  const choice = visibilityPayload("media-visibility", "media-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "gallery",
    sectionId,
    subsectionId: document.getElementById("media-subsection").value,
    ...choice
  };
  const input = document.getElementById("asset-file-input");
  input.accept = "";
  input.click();
});
document.getElementById("content-section-upload-file").addEventListener("click", () => {
  const sectionId = document.getElementById("content-section").value;
  if (!sectionId) return;
  const choice = visibilityPayload("content-visibility", "content-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "section",
    sectionId,
    subsectionId: document.getElementById("content-subsection").value,
    ...choice
  };
  document.getElementById("content-section-file-input").click();
});
document.getElementById("content-section-upload-photo").addEventListener("click", () => {
  const sectionId = document.getElementById("content-section").value;
  if (!sectionId) return;
  const choice = visibilityPayload("content-visibility", "content-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "section-photo",
    sectionId,
    subsectionId: document.getElementById("content-subsection").value,
    ...choice
  };
  document.getElementById("content-section-photo-input").click();
});
document.getElementById("article-upload-file").addEventListener("click", () => {
  const contentId = document.getElementById("content-id").value;
  if (!contentId) {
    alert("请先保存文章草稿");
    return;
  }
  const choice = visibilityPayload("content-visibility", "content-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  const input = document.getElementById("article-file-input");
  app.assetUploadContext = { scope: "article", contentId, ...choice };
  input.click();
});
document.getElementById("article-file-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || {};
  app.assetUploadContext = null;
  event.target.value = "";
  await runAssetUpload(files, context);
});
document.getElementById("content-section-file-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || {};
  app.assetUploadContext = null;
  event.target.value = "";
  await runAssetUpload(files, context);
});
document.getElementById("content-section-photo-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || {};
  app.assetUploadContext = null;
  event.target.value = "";
  await runSectionPhotoUploads(files, context, "content-section-asset-notice");
});
document.getElementById("asset-photo-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || {};
  app.assetUploadContext = null;
  event.target.value = "";
  await runSectionPhotoUploads(files, context, "asset-notice");
});
document.getElementById("asset-upload-folder").addEventListener("click", () => {
  const choice = visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  if (!validateVisibilityChoice(choice)) return;
  app.assetUploadContext = {
    scope: "library",
    sectionId: currentAssetSection(),
    subsectionId: document.getElementById("asset-subsection").value,
    note: document.getElementById("asset-upload-note").value,
    folderMode: true,
    ...choice
  };
  document.getElementById("asset-folder-input").click();
});
document.getElementById("asset-file-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || {};
  app.assetUploadContext = null;
  event.target.value = "";
  event.target.accept = "";
  await runAssetUpload(files, context);
});
document.getElementById("asset-folder-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  const context = app.assetUploadContext || { scope: "library", folderMode: true };
  app.assetUploadContext = null;
  event.target.value = "";
  await runAssetUpload(files, context);
});
document.getElementById("asset-variant-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  const target = app.variantTarget;
  app.variantTarget = null;
  if (!file || !target) return;
  try {
    await uploadAssetFile(file, { assetId: target.item.id, variantLabel: target.label });
    await loadAssets();
  } catch (error) {
    document.getElementById("asset-notice").textContent = `版本上传失败：${error.message}`;
  }
});
document.getElementById("asset-poster-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  const target = app.posterTarget;
  event.target.value = "";
  app.posterTarget = null;
  if (!file || !target) return;
  const form = new FormData();
  form.append("poster", file, file.name);
  try {
    await api(`/api/admin/assets/${target.id}/poster`, { method: "POST", body: form });
    await loadAssets();
  } catch (error) {
    alert(`视频封面保存失败：${error.message}`);
  }
});
