/*
 * 旧照片补建/重建高清预览：只读取原片并上传新 WebP，服务器不会覆盖
 * object_key。已有 1280px 预览也可使用此按钮升级为 2560px 版本。
 * 站长后台 Cookie 也能读取会员板块原片，普通游客仍然没有该权限。
 */
async function backfillMediaPreview(item, control) {
  const oldText = control.textContent;
  control.disabled = true;
  control.textContent = "正在读取原片…";
  try {
    const response = await fetch(`/api/admin/media/${item.id}/source`, { cache: "no-store" });
    if (!response.ok) throw new Error(`原片读取失败（${response.status}）`);
    const originalBlob = await response.blob();
    const originalFile = new File([originalBlob], item.filename, {
      type: item.mime_type || originalBlob.type
    });
    control.textContent = "正在压缩…";
    const preview = await createCompressedPreview(originalFile);
    const form = new FormData();
    form.append("preview", preview, preview.name);
    control.textContent = "正在保存…";
    await api(`/api/admin/media/${item.id}/preview`, { method: "POST", body: form });
    await loadAlbumsAndMedia();
  } catch (error) {
    alert(`生成压缩预览失败：${error.message}`);
    control.disabled = false;
    control.textContent = oldText;
  }
}
// 移动和权限保存共用卡片锁，避免同一张照片的两个操作互相覆盖。
function lockMediaCard(item, control) {
  if (app.busyMediaIds.has(item.id)) return null;
  app.busyMediaIds.add(item.id);
  const card = control.closest(".media-card");
  const fields = [...(card?.querySelectorAll("button, input, select, textarea") || [control])];
  const disabledStates = fields.map((field) => field.disabled);
  fields.forEach((field) => {
    field.disabled = true;
  });
  return () => {
    app.busyMediaIds.delete(item.id);
    fields.forEach((field, index) => {
      field.disabled = disabledStates[index];
    });
  };
}

function refreshMediaCardSummary(item, summary) {
  if (!summary) return;
  const locationLabel =
    item.subsection_name ||
    app.subsections.find((value) => value.id === item.subsection_id)?.name ||
    "未分类";
  const audienceCount = visibilityUsesAudience(item.visibility)
    ? `（${item.allowed_user_ids?.length || 0} 人）`
    : "";
  summary.textContent = `${locationLabel} · ${visibilityLabels[item.visibility] || visibilityLabels.public}${audienceCount} · ${item.hasPreview ? "压缩预览已生成" : "旧图尚无压缩预览"}`;
}

async function moveUploadedPhoto(item, destination, moveButton, moveStatus) {
  const targetId = destination.value || null;
  if (targetId === (item.subsection_id || null)) return;
  const unlock = lockMediaCard(item, moveButton);
  if (!unlock) return;
  const card = moveButton.closest(".media-card");
  moveButton.textContent = "正在移动…";
  moveStatus.textContent = "正在保存照片归类…";
  try {
    const result = await api(`/api/admin/media/${item.id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subsectionId: targetId })
    });
    const location = {
      section_id: result.section_id,
      subsection_id: result.subsection_id,
      subsection_name: result.subsection_name,
      album_id: result.album_id,
      updated_at: result.updated_at
    };
    Object.assign(item, location);
    const current = app.media.find((photo) => photo.id === item.id);
    if (current && current !== item) Object.assign(current, location);
    (result.subsectionCounts || []).forEach((count) => {
      const subsection = app.subsections.find((value) => value.id === count.id);
      if (subsection) subsection.media_count = count.media_count;
    });
    destination.value = item.subsection_id || "";
    const message = `“${item.caption || item.filename}”已移动到“${item.subsection_name || "未分类"}”。`;
    moveStatus.textContent = message;
    document.getElementById("media-notice").textContent = message;
    refreshMediaCardSummary(item, card?.querySelector(".media-info > small"));
    renderAlbums();
    renderSubsectionList();
    const activeSection = document.getElementById("media-section").value;
    const activeSubsection = document.getElementById("media-subsection").value;
    if (
      activeSection === item.section_id &&
      activeSubsection &&
      activeSubsection !== item.subsection_id
    )
      card?.remove();
  } catch (error) {
    moveStatus.textContent = `移动失败：${error.message}`;
  } finally {
    unlock();
    moveButton.textContent = "移动照片";
    moveButton.disabled = destination.value === (item.subsection_id || "");
  }
}

/*
 * 修改单张图片的权限。请求会保留它原来的板块、相册、说明和类型，
 * 只更改可见范围及白名单，防止调整权限时意外把照片移出原相册。
 */
async function updateMediaVisibility(item, control, audiencePicker, saveButton) {
  const previous = item.visibility || "public";
  const next = control.value;
  const allowedUserIds = selectedAudienceIds(audiencePicker);
  if (visibilityUsesAudience(next) && !allowedUserIds.length) {
    alert("请至少勾选一个已审核账号");
    return;
  }
  const unlock = lockMediaCard(item, saveButton);
  if (!unlock) return;
  const oldButtonText = "保存照片权限";
  saveButton.textContent = "正在保存…";
  try {
    await api(`/api/admin/media/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next, allowedUserIds })
    });
    item.visibility = next;
    item.allowed_user_ids = visibilityUsesAudience(next) ? allowedUserIds : [];
    const summary = saveButton.closest(".media-info")?.querySelector("small");
    refreshMediaCardSummary(item, summary);
    document.getElementById("media-notice").textContent =
      `“${item.caption || item.filename}”的照片权限已保存。`;
    saveButton.textContent = "已保存";
    saveButton.closest(".media-card")?.classList.remove("is-editing");
    let status = saveButton.parentElement.querySelector(".media-save-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "status media-save-status";
      status.setAttribute("role", "status");
      saveButton.parentElement.append(status);
    }
    status.textContent = `已保存：${visibilityLabels[next]}`;
    setTimeout(() => {
      if (saveButton.isConnected && saveButton.textContent === "已保存")
        saveButton.textContent = oldButtonText;
    }, 1200);
  } catch (error) {
    control.value = previous;
    audiencePicker.classList.toggle("hidden", !visibilityUsesAudience(previous));
    saveButton.textContent = oldButtonText;
    alert(`可见范围保存失败：${error.message}`);
  } finally {
    unlock();
  }
}
async function editManagedPhotoVisibility(item) {
  const choice = await openVisibilityEditor(
    `设置“${item.caption || item.filename}”的权限`,
    item.visibility,
    item.allowed_user_ids || []
  );
  if (!choice) return;
  await api(`/api/admin/media/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sectionId: item.section_id,
      subsectionId: item.subsection_id,
      albumId: item.album_id,
      caption: item.caption,
      kind: item.kind,
      ...choice
    })
  });
  await loadAlbumsAndMedia();
}
async function deleteMedia(item) {
  if (!confirm(`确定删除“${item.filename}”吗？原图将同时删除。`)) return;
  await api(`/api/admin/media/${item.id}`, { method: "DELETE" });
  await loadAlbumsAndMedia();
  await loadDashboard();
}
async function toggleComment(item) {
  await api(`/api/admin/comments/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: item.status === "hidden" ? "active" : "hidden" })
  });
  await loadComments();
}
async function deleteComment(item) {
  if (!confirm("确定删除这条评论及其回复吗？")) return;
  await api(`/api/admin/comments/${item.id}`, { method: "DELETE" });
  await loadComments();
  await loadDashboard();
}
