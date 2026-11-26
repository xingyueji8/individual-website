async function loadAlbumsAndMedia() {
  app.media = await api("/api/admin/media");
  renderAlbums();
  renderMedia();
  renderAssetBrowser();
  renderContentSectionAssets();
  refreshCoverOptions();
  renderArticleAssets();
}
function renderAlbums() {
  const row = document.getElementById("album-row");
  const sectionId = document.getElementById("media-section").value;
  clear(row);
  const items = app.subsections.filter((item) => item.section_id === sectionId);
  items.forEach((item) => {
    const wrap = document.createElement("span");
    wrap.className = "album-chip";
    const choose = button(
      `${item.name}（图片 ${item.media_count || 0} / 文件 ${item.asset_count || 0}）· ${visibilityLabels[item.visibility] || "公开"}`
    );
    choose.addEventListener("click", () => {
      if (app.currentView === "sections" && studioSectionCategory === "gallery") {
        selectStudioBoard("subsection", item.id);
        return;
      }
      document.getElementById("media-subsection").value = item.id;
      document.getElementById("media-album").value = item.id;
      renderMedia();
    });
    const edit = button("编辑", "btn small ghost");
    edit.addEventListener("click", () => {
      if (enterSectionManager("gallery") && selectStudioBoard("subsection", item.id))
        setArticlePanelVisible("settings", true);
    });
    wrap.append(choose, edit);
    row.append(wrap);
  });
  refreshMediaSubsectionOptions(sectionId);
}
function renderMedia() {
  const grid = document.getElementById("media-grid");
  const sectionId = document.getElementById("media-section").value;
  const subsectionId = document.getElementById("media-subsection").value;
  clear(grid);
  app.media
    .filter(
      (item) =>
        item.kind === "photo" &&
        item.section_id === sectionId &&
        (!subsectionId || item.subsection_id === subsectionId)
    )
    .forEach((item) => {
      const card = document.createElement("article");
      card.className = "media-card";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = `/api/admin/media/${item.id}/source?preview=1`;
      img.alt = item.caption || item.filename;
      const info = document.createElement("div");
      info.className = "media-info";
      const title = document.createElement("strong");
      title.textContent = item.caption || item.filename;
      const small = document.createElement("small");
      const locationLabel =
        item.subsection_name ||
        app.subsections.find((value) => value.id === item.subsection_id)?.name ||
        "未分类";
      const audienceCount = visibilityUsesAudience(item.visibility)
        ? `（${item.allowed_user_ids?.length || 0} 人）`
        : "";
      small.textContent = `${locationLabel} · ${visibilityLabels[item.visibility] || visibilityLabels.public}${audienceCount} · ${item.hasPreview ? "压缩预览已生成" : "旧图尚无压缩预览"}`;

      const moveField = document.createElement("div");
      moveField.className = "media-visibility media-location";
      const moveLabel = document.createElement("label");
      moveLabel.textContent = "移动到小板块";
      const destination = document.createElement("select");
      destination.id = `media-destination-${item.id}`;
      moveLabel.htmlFor = destination.id;
      destination.setAttribute("aria-label", `${item.caption || item.filename}的目标小板块`);
      fillSubsectionSelect(destination, item.section_id, item.subsection_id || "");
      const moveButton = button("移动照片");
      moveButton.disabled = true;
      const moveStatus = document.createElement("p");
      moveStatus.className = "status media-move-status";
      moveStatus.setAttribute("role", "status");
      moveStatus.setAttribute("aria-live", "polite");
      destination.addEventListener("change", () => {
        moveButton.disabled =
          app.busyMediaIds.has(item.id) || destination.value === (item.subsection_id || "");
        moveStatus.textContent = "";
      });
      moveButton.addEventListener("click", () =>
        moveUploadedPhoto(item, destination, moveButton, moveStatus)
      );
      moveField.append(moveLabel, destination, moveButton, moveStatus);

      // 已上传照片不必删除重传，可直接在卡片内调整四级权限和用户白名单。
      const visibilityField = document.createElement("div");
      visibilityField.className = "media-visibility";
      const visibilityLabel = document.createElement("label");
      visibilityLabel.textContent = "可见范围";
      const visibilitySelect = document.createElement("select");
      visibilitySelect.setAttribute("aria-label", `${item.caption || item.filename}的可见范围`);
      [
        ["public", "公开（游客与用户）"],
        ["member", "仅审核用户"],
        ["selected", "仅指定用户"],
        ["excluded", "不给指定用户看"],
        ["private", "仅本人可见"]
      ].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        visibilitySelect.append(option);
      });
      visibilitySelect.value = item.visibility || "public";
      const audiencePicker = document.createElement("div");
      audiencePicker.className = "audience-picker";
      renderAudiencePicker(audiencePicker, item.allowed_user_ids || []);
      audiencePicker.classList.toggle("hidden", !visibilityUsesAudience(visibilitySelect.value));
      visibilitySelect.addEventListener("change", () => {
        audiencePicker.classList.toggle("hidden", !visibilityUsesAudience(visibilitySelect.value));
        card.classList.add("is-editing");
      });
      audiencePicker.addEventListener("change", () => card.classList.add("is-editing"));
      const saveVisibility = button("保存照片权限");
      saveVisibility.addEventListener("click", () =>
        updateMediaVisibility(item, visibilitySelect, audiencePicker, saveVisibility)
      );
      visibilityField.append(visibilityLabel, visibilitySelect, audiencePicker, saveVisibility);

      const actions = document.createElement("div");
      actions.className = "list-actions";
      actions.append(studioShareButton("media", item));

      // 所有照片都允许重新生成：旧的 1280px 预览可直接升级为 2560px 高清预览。
      if (item.kind === "photo") {
        const createPreview = button(item.hasPreview ? "重建高清预览" : "生成高清预览");
        createPreview.addEventListener("click", () => backfillMediaPreview(item, createPreview));
        actions.append(createPreview);
      }
      const del = button("删除", "btn small danger");
      del.addEventListener("click", () => deleteMedia(item));
      actions.append(del);
      info.append(title, small, moveField, visibilityField, actions);
      card.append(img, info);
      attachPhotoControls(card, item, actions);
      title.textContent = `${item.caption || item.filename}${item.note ? ` · ${item.note}` : ""}`;
      grid.append(card);
    });
  updatePhotoBatchCount();
  fillPhotoMoveTargets();
}
function refreshCoverOptions() {
  const select = document.getElementById("content-cover");
  if (!select) return;
  const current = select.value;
  clear(select);
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "无封面";
  select.append(none);
  app.media
    .filter(
      (item) =>
        item.kind !== "inline" ||
        (item.content_id && item.content_id === document.getElementById("content-id").value) ||
        item.id === current ||
        studioArticleImages.uploaded.has(item.id)
    )
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.caption || item.filename;
      select.append(option);
    });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  updateCoverPreview();
}
