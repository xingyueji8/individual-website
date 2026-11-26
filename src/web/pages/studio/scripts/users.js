/* ---------- 普通用户、注册审核与密码重置 ---------- */
const userStatusLabels = {
  pending: "待审核",
  approved: "已批准",
  rejected: "未通过",
  disabled: "已停用"
};
const eventLabels = {
  register: "注册申请",
  login_success: "登录成功",
  login_failed: "登录失败",
  login_blocked: "登录被阻止",
  logout: "退出登录",
  password_change: "修改密码",
  password_reset: "重置密码"
};
const resetStatusLabels = {
  pending: "待核实",
  approved: "链接已生成",
  rejected: "已拒绝",
  used: "已完成",
  expired: "已过期"
};

async function loadUsers() {
  const contentSelection = selectedAudienceIds("content-user-picker");
  const mediaSelection = selectedAudienceIds("media-user-picker");
  const profileSelections = Object.fromEntries(
    Object.entries(profileAccessControls).map(([sectionKey, [, pickerId]]) => [
      sectionKey,
      selectedAudienceIds(pickerId)
    ])
  );
  [app.users, app.passwordResets] = await Promise.all([
    api("/api/admin/users"),
    api("/api/admin/password-resets")
  ]);
  renderUsers();
  renderPasswordResets();
  renderAudiencePicker("content-user-picker", contentSelection);
  renderAudiencePicker("media-user-picker", mediaSelection);
  Object.entries(profileAccessControls).forEach(([sectionKey, [selectId, pickerId]]) =>
    syncAudiencePicker(selectId, pickerId, profileSelections[sectionKey])
  );
  if (app.media.length && !app.busyMediaIds.size && !document.querySelector("#media-grid .is-editing"))
    renderMedia();
}

function renderUsers() {
  const list = document.getElementById("user-list");
  clear(list);
  if (!app.users.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "还没有注册用户。";
    list.append(p);
    return;
  }
  app.users.forEach((item) => {
    const card = document.createElement("article");
    card.className = `user-card ${item.status}`;
    const head = document.createElement("div");
    head.className = "user-head";
    const title = document.createElement("h3");
    title.textContent = `${item.nickname} · @${item.username}`;
    const state = document.createElement("span");
    state.className = `user-state ${item.status}`;
    const dot = document.createElement("span");
    dot.className = `online-dot${item.is_online ? " online" : ""}`;
    state.append(
      dot,
      document.createTextNode(
        `${userStatusLabels[item.status] || item.status} · ${item.is_online ? "在线" : "离线"}`
      )
    );
    head.append(title, state);

    const data = document.createElement("div");
    data.className = "user-data";
    const contact = document.createElement("div");
    contact.textContent = `验证称呼：${item.display_name || "未填写"} · 联系方式：${contactLabel(item.contact_type)} ${item.contact_value || ""}`;
    const dates = document.createElement("div");
    dates.textContent = `注册：${formatDate(item.created_at)} · 最后登录：${formatDate(item.last_login_at) || "从未"} · 有效会话：${item.active_session_count || 0}`;
    data.append(contact, dates);
    if (item.invite_code) {
      const invite = document.createElement("div");
      invite.textContent = `邀请码：${item.invite_code}`;
      data.append(invite);
    }

    const note = document.createElement("div");
    note.className = "user-note";
    note.textContent = item.note ? `申请备注：${item.note}` : "申请备注：未填写";
    const review = document.createElement("div");
    review.className = "user-note";
    review.textContent = item.review_note ? `审核备注：${item.review_note}` : "审核备注：未填写";
    const adminNote = document.createElement("section");
    adminNote.className = "user-admin-note";
    const adminNoteLabel = document.createElement("label");
    adminNoteLabel.textContent = "站长私有备注（仅后台可见）";
    const adminNoteInput = document.createElement("textarea");
    adminNoteInput.maxLength = 1200;
    adminNoteInput.placeholder = "例如：姓名、关系、账号用途或需要记住的事项";
    adminNoteInput.value = item.admin_note || "";
    const adminNoteActions = document.createElement("div");
    adminNoteActions.className = "list-actions";
    const saveAdminNote = button("保存私有备注", "btn small");
    saveAdminNote.addEventListener("click", () =>
      saveUserAdminNote(item, adminNoteInput, saveAdminNote)
    );
    adminNoteActions.append(saveAdminNote);
    adminNote.append(adminNoteLabel, adminNoteInput, adminNoteActions);
    const actions = document.createElement("div");
    actions.className = "list-actions";
    if (item.status !== "approved") {
      const approve = button("批准账号", "btn small");
      approve.addEventListener("click", () => updateUserStatus(item, "approved"));
      actions.append(approve);
    }
    if (item.status !== "rejected") {
      const reject = button("拒绝申请", "btn small ghost");
      reject.addEventListener("click", () => updateUserStatus(item, "rejected"));
      actions.append(reject);
    }
    if (item.status !== "disabled") {
      const disable = button("停用账号", "btn small danger");
      disable.addEventListener("click", () => updateUserStatus(item, "disabled"));
      actions.append(disable);
    } else {
      const restore = button("恢复为待审核", "btn small ghost");
      restore.addEventListener("click", () => updateUserStatus(item, "pending"));
      actions.append(restore);
    }
    const traces = button("登录痕迹", "btn small ghost");
    traces.addEventListener("click", () => loadUserEvents(item));
    actions.append(traces);
    card.append(head, data, note, review, adminNote, actions);
    list.append(card);
  });
}

function contactLabel(type) {
  return { qq: "QQ", wechat: "微信", email: "邮箱", phone: "手机号", other: "其他" }[type] || "其他";
}

async function updateUserStatus(item, status) {
  const reviewNote = prompt("审核备注（选填）", item.review_note || "");
  if (reviewNote === null) return;
  if (status === "disabled" && !confirm(`确定停用账号“${item.username}”并注销其全部会话吗？`)) return;
  await api(`/api/admin/users/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewNote })
  });
  await Promise.all([loadUsers(), loadDashboard()]);
}

async function saveUserAdminNote(item, input, control) {
  const oldText = control.textContent;
  control.disabled = true;
  control.textContent = "正在保存…";
  try {
    const result = await api(`/api/admin/users/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminNote: input.value })
    });
    item.admin_note = result.admin_note || "";
    input.value = item.admin_note;
    control.textContent = "已保存";
    setTimeout(() => {
      if (control.isConnected) {
        control.textContent = oldText;
        control.disabled = false;
      }
    }, 1200);
  } catch (error) {
    control.disabled = false;
    control.textContent = oldText;
    alert(`私有备注保存失败：${error.message}`);
  }
}

async function loadUserEvents(item) {
  app.userEvents = await api(`/api/admin/user-events/${item.id}`);
  document.getElementById("event-title").textContent = `${item.nickname} 的登录痕迹`;
  const list = document.getElementById("user-event-list");
  clear(list);
  if (!app.userEvents.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "暂无登录记录。";
    list.append(p);
    return;
  }
  app.userEvents.forEach((event) => {
    const row = document.createElement("div");
    row.className = "event-row";
    const title = document.createElement("strong");
    title.textContent = `${eventLabels[event.event_type] || event.event_type} · ${formatDate(event.created_at)}`;
    const detail = document.createElement("small");
    detail.textContent = `网络位置：${event.ip_hint || "未知"} · 设备：${event.user_agent || "未知"}`;
    row.append(title, detail);
    list.append(row);
  });
}

function renderPasswordResets() {
  const list = document.getElementById("password-reset-list");
  clear(list);
  if (!app.passwordResets.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "暂无密码重置申请。";
    list.append(p);
    return;
  }
  app.passwordResets.forEach((item) => {
    const card = document.createElement("article");
    card.className = `reset-card ${item.status}`;
    const head = document.createElement("div");
    head.className = "user-head";
    const title = document.createElement("h3");
    title.textContent = `${item.nickname} · @${item.username}`;
    const state = document.createElement("span");
    state.className = `user-state ${item.status}`;
    state.textContent = resetStatusLabels[item.status] || item.status;
    head.append(title, state);
    const data = document.createElement("div");
    data.className = "user-data";
    data.textContent = `${contactLabel(item.contact_type)} ${item.contact_value} · 申请于 ${formatDate(item.requested_at)} · 网络位置 ${item.ip_hint || "未知"}`;
    const actions = document.createElement("div");
    actions.className = "list-actions";
    if (["pending", "approved", "expired", "rejected"].includes(item.status)) {
      const approve = button(
        item.status === "approved" ? "重新生成链接" : "核实通过并生成链接",
        "btn small"
      );
      approve.addEventListener("click", () =>
        runResetAction(item, item.status === "approved" ? "regenerate" : "approve")
      );
      actions.append(approve);
    }
    if (!["used", "rejected"].includes(item.status)) {
      const reject = button("拒绝", "btn small danger");
      reject.addEventListener("click", () => runResetAction(item, "reject"));
      actions.append(reject);
    }
    card.append(head, data, actions);
    const generated = app.generatedResetLinks.get(item.id);
    if (generated) {
      const box = document.createElement("div");
      box.className = "reset-link";
      const input = document.createElement("input");
      input.readOnly = true;
      input.value = generated.url;
      const copy = button("复制24小时一次性链接", "btn small");
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(input.value);
        copy.textContent = "已复制";
      });
      const expiry = document.createElement("div");
      expiry.className = "list-meta";
      expiry.textContent = `有效至：${formatDate(generated.expiresAt)}。此链接只在当前生成后显示，请立即发送给用户。`;
      box.append(input, copy, expiry);
      card.append(box);
    }
    list.append(card);
  });
}

async function runResetAction(item, action) {
  if (action !== "reject" && !confirm("请确认你已经通过该账户原来登记的联系方式核实了用户身份。"))
    return;
  const result = await api(`/api/admin/password-resets/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  if (result.resetUrl)
    app.generatedResetLinks.set(item.id, { url: result.resetUrl, expiresAt: result.expiresAt });
  else app.generatedResetLinks.delete(item.id);
  await Promise.all([loadUsers(), loadDashboard()]);
}
