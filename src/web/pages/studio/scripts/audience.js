/* ---------- 文章/照片指定用户白名单 ---------- */
function approvedAudienceUsers() {
  return app.users.filter((item) => item.status === "approved");
}
function audienceNode(target) {
  return typeof target === "string" ? document.getElementById(target) : target;
}
function selectedAudienceIds(target) {
  const host = audienceNode(target);
  if (!host) return [];
  return [...host.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}
function renderAudiencePicker(target, selectedIds = []) {
  const host = audienceNode(target);
  if (!host) return;
  const selected = new Set((selectedIds || []).map(String));
  clear(host);
  const users = approvedAudienceUsers();
  if (!users.length) {
    const empty = document.createElement("p");
    empty.className = "audience-empty";
    empty.textContent = "目前没有已审核账号，请先在“用户与审核”中批准用户。";
    host.append(empty);
    return;
  }
  users.forEach((user) => {
    const label = document.createElement("label");
    label.className = "audience-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = user.id;
    input.checked = selected.has(user.id);
    const name = document.createElement("span");
    name.textContent = `${user.nickname}（@${user.username}）`;
    label.append(input, name);
    host.append(label);
  });
}
function visibilityUsesAudience(value) {
  return value === "selected" || value === "excluded";
}
function syncAudiencePicker(selectTarget, pickerTarget, selectedIds = []) {
  const select = audienceNode(selectTarget);
  const picker = audienceNode(pickerTarget);
  if (!select || !picker) return;
  renderAudiencePicker(picker, selectedIds);
  picker.classList.toggle("hidden", !visibilityUsesAudience(select.value));
}
function visibilityPayload(selectTarget, pickerTarget) {
  const visibility = audienceNode(selectTarget).value;
  return {
    visibility,
    allowedUserIds: visibilityUsesAudience(visibility) ? selectedAudienceIds(pickerTarget) : []
  };
}
function validateVisibilityChoice(choice, messageTarget = null) {
  const valid = !visibilityUsesAudience(choice.visibility) || choice.allowedUserIds.length > 0;
  if (!valid) {
    const text =
      choice.visibility === "excluded"
        ? "选择‘不给指定用户看’时，请至少勾选一个账号。"
        : "选择‘仅指定用户’时，请至少勾选一个账号。";
    if (messageTarget) messageTarget.textContent = text;
    else alert(text);
  }
  return valid;
}
function profileAccessPayload() {
  return Object.fromEntries(
    Object.entries(profileAccessControls).map(([sectionKey, [selectId, pickerId]]) => [
      sectionKey,
      visibilityPayload(selectId, pickerId)
    ])
  );
}
function validateProfileAccess(profileAccess, messageTarget = null) {
  return Object.values(profileAccess).every((choice) =>
    validateVisibilityChoice(choice, messageTarget)
  );
}
function openVisibilityEditor(title, visibility = "public", allowedUserIds = []) {
  const dialog = document.getElementById("visibility-editor-dialog");
  document.getElementById("visibility-editor-title").textContent = title;
  document.getElementById("visibility-editor-mode").value = visibility || "public";
  syncAudiencePicker("visibility-editor-mode", "visibility-editor-users", allowedUserIds);
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    app.visibilityEditor = { resolve };
  });
}
