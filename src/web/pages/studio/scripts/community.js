async function loadComments() {
  app.comments = await api("/api/admin/comments");
  renderAdminComments();
  renderCurrentContentComments();
}
function renderAdminComments() {
  const list = document.getElementById("comment-admin-list");
  clear(list);
  if (!app.comments.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "暂无评论。";
    list.append(p);
    return;
  }
  app.comments.forEach((item) => {
    const row = document.createElement("article");
    row.className = "comment-row";
    const head = document.createElement("strong");
    head.textContent = `${item.guest_name} · ${item.content_title || "内容已删除"}`;
    if (Number(item.is_admin)) {
      const badge = document.createElement("span");
      badge.className = "admin-badge";
      badge.textContent = "站长";
      head.append(" ", badge);
    }
    const meta = document.createElement("small");
    meta.textContent = `${formatDate(item.created_at)} · ${item.status === "hidden" ? "已隐藏" : "公开"}${Number(item.is_pinned) ? " · 已置顶" : ""}${Number(item.author_liked) ? " · 作者已赞" : ""}`;
    const body = document.createElement("p");
    body.textContent = item.body;
    const actions = document.createElement("div");
    actions.className = "list-actions";
    const toggle = button(item.status === "hidden" ? "恢复显示" : "隐藏");
    toggle.addEventListener("click", () => toggleComment(item));
    const reply = button("站长回复", "btn small");
    reply.addEventListener("click", () => replyCommentAsOwner(item));
    const pin = button(Number(item.is_pinned) ? "取消置顶" : "置顶");
    pin.addEventListener("click", () => setCommentFlag(item, "pin", !Number(item.is_pinned)));
    const authorLike = button(Number(item.author_liked) ? "取消作者赞" : "作者点赞");
    authorLike.addEventListener("click", () =>
      setCommentFlag(item, "author-like", !Number(item.author_liked))
    );
    const del = button("删除", "btn small danger");
    del.addEventListener("click", () => deleteComment(item));
    actions.append(reply, pin, authorLike, toggle, del);
    row.append(head, document.createElement("br"), meta, body, actions);
    list.append(row);
  });
}
function renderCurrentContentComments() {
  const host = document.getElementById("current-content-comments");
  if (!host) return;
  clear(host);
  const contentId = document.getElementById("content-id").value;
  if (!contentId) return;
  const comments = app.comments.filter((item) => item.content_id === contentId);
  if (!comments.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "这篇文章暂无评论。";
    host.append(p);
    return;
  }
  comments.forEach((item) => {
    const row = document.createElement("article");
    row.className = "comment-row";
    const head = document.createElement("strong");
    head.textContent = `${item.guest_name}${Number(item.is_admin) ? " · 站长" : ""}`;
    const meta = document.createElement("small");
    meta.textContent = `${formatDate(item.created_at)}${Number(item.is_pinned) ? " · 已置顶" : ""}${Number(item.author_liked) ? " · 作者已赞" : ""}`;
    const body = document.createElement("p");
    body.textContent = item.body;
    const actions = document.createElement("div");
    actions.className = "list-actions";
    const reply = button("回复");
    reply.addEventListener("click", () => replyCommentAsOwner(item));
    const pin = button(Number(item.is_pinned) ? "取消置顶" : "置顶");
    pin.addEventListener("click", () => setCommentFlag(item, "pin", !Number(item.is_pinned)));
    const like = button(Number(item.author_liked) ? "取消作者赞" : "作者点赞");
    like.addEventListener("click", () =>
      setCommentFlag(item, "author-like", !Number(item.author_liked))
    );
    actions.append(reply, pin, like);
    row.append(head, document.createElement("br"), meta, body, actions);
    host.append(row);
  });
}
async function setCommentFlag(item, action, value) {
  await api(`/api/admin/comments/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value })
  });
  await loadComments();
}
async function replyCommentAsOwner(item) {
  const body = prompt(`以站长身份回复 ${item.guest_name}`);
  if (!body?.trim()) return;
  await api(`/api/admin/comments/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply", body })
  });
  await loadComments();
}

async function loadStudioMessages() {
  const data = await api("/api/admin/messages");
  app.messageOwner = data.owner;
  app.messageContacts = data.contacts || [];
  renderStudioMessageContacts();
}
function renderStudioMessageContacts() {
  const host = document.getElementById("studio-message-contacts");
  clear(host);
  const known = new Map(app.messageContacts.map((item) => [item.id, item]));
  app.users
    .filter((item) => item.status === "approved" && item.id !== app.messageOwner?.id)
    .forEach((user) => {
      if (!known.has(user.id))
        known.set(user.id, { ...user, last_body: "尚未开始会话", unread_count: 0 });
    });
  if (!known.size) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "没有可私信的已审核用户。";
    host.append(p);
    return;
  }
  [...known.values()].forEach((item) => {
    const control = button(`${item.nickname} · ${item.last_body || ""}`, "message-contact");
    control.addEventListener("click", () => openStudioMessage(item.id));
    host.append(control);
  });
}
async function openStudioMessage(userId) {
  const data = await api(`/api/admin/messages/${encodeURIComponent(userId)}`);
  app.messagePeer = data.peer;
  document.getElementById("studio-message-title").textContent = `站长与 ${data.peer.nickname} 的私信`;
  const thread = document.getElementById("studio-message-thread");
  clear(thread);
  (data.messages || []).forEach((item) => {
    const bubble = document.createElement("div");
    bubble.className = `message-bubble${item.sender_user_id === app.messageOwner.id ? " mine" : ""}`;
    bubble.textContent = item.body;
    thread.append(bubble);
  });
  thread.scrollTop = thread.scrollHeight;
  document.getElementById("studio-message-form").classList.remove("hidden");
}

async function loadFeedback() {
  app.feedback = await api("/api/admin/feedback");
  renderAdminFeedback();
}

/*
 * 留言板不会向游客提供回复按钮。这里的编辑器只存在于已通过
 * ADMIN_PASSWORD 验证的 Studio 中，保存时调用受保护的 /api/admin 路由。
 */
function renderAdminFeedback() {
  const list = document.getElementById("feedback-admin-list");
  clear(list);
  const filtered = app.feedback.filter((item) =>
    app.feedbackArchive ? item.status === "resolved" : item.status !== "resolved"
  );
  document.getElementById("feedback-open-tab").classList.toggle("active", !app.feedbackArchive);
  document.getElementById("feedback-open-tab").classList.toggle("ghost", app.feedbackArchive);
  document.getElementById("feedback-archive-tab").classList.toggle("active", app.feedbackArchive);
  document.getElementById("feedback-archive-tab").classList.toggle("ghost", !app.feedbackArchive);
  if (!filtered.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = app.feedbackArchive ? "已解决信箱为空。" : "暂无待处理留言。";
    list.append(p);
    return;
  }
  const labels = { message: "留言", bug: "网站问题", suggestion: "功能建议" };
  filtered.forEach((item) => {
    const row = document.createElement("article");
    row.className = `feedback-admin-row${item.status === "new" ? " unread" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${labels[item.category] || "留言"} · ${item.guest_name}`;
    const meta = document.createElement("div");
    meta.className = "list-meta";
    meta.textContent = `${formatDate(item.created_at)} · ${item.contact ? `联系方式：${item.contact}` : "未留联系方式"} · ${item.status === "new" ? "未读" : item.status === "resolved" ? "已解决" : "已读"} · ${Number(item.is_public) ? "公开" : "不公开"}`;
    const body = document.createElement("p");
    body.textContent = item.body;

    const replyEditor = document.createElement("section");
    replyEditor.className = "feedback-reply-editor";
    const replyLabel = document.createElement("label");
    replyLabel.textContent = "站长回复（只有你能填写）";
    const replyInput = document.createElement("textarea");
    replyInput.maxLength = 3000;
    replyInput.placeholder = "填写后会显示在这条公开留言下方";
    replyInput.value = item.admin_reply || "";
    const replyActions = document.createElement("div");
    replyActions.className = "list-actions";
    const saveReply = button(item.admin_reply ? "更新站长回复" : "发表站长回复", "btn small");
    saveReply.addEventListener("click", () => saveFeedbackReply(item, replyInput.value, saveReply));
    replyActions.append(saveReply);
    if (item.admin_reply) {
      const clearReply = button("清空回复", "btn small ghost");
      clearReply.addEventListener("click", () => clearFeedbackReply(item, clearReply));
      replyActions.append(clearReply);
    }
    const replyHint = document.createElement("span");
    replyHint.className = "feedback-reply-hint";
    replyHint.textContent = Number(item.is_public)
      ? item.admin_replied_at
        ? `最近回复：${formatDate(item.admin_replied_at)}`
        : "回复保存后会立即公开显示"
      : "这条留言当前未公开，回复会保存但不会在网站显示";
    replyActions.append(replyHint);
    replyEditor.append(replyLabel, replyInput, replyActions);

    const actions = document.createElement("div");
    actions.className = "list-actions";
    const read = button("标为已读");
    read.addEventListener("click", () => updateFeedback(item, "read", Number(item.is_public) === 1));
    const resolved = button("标为已解决");
    resolved.addEventListener("click", () =>
      updateFeedback(item, "resolved", Number(item.is_public) === 1)
    );
    const publish = button(Number(item.is_public) ? "取消公开" : "公开到留言板");
    publish.addEventListener("click", () =>
      updateFeedback(item, item.status === "new" ? "read" : item.status, Number(item.is_public) !== 1)
    );
    const del = button("永久删除留言", "btn small danger");
    del.addEventListener("click", () => deleteFeedback(item));
    actions.append(read, resolved, publish, del);
    row.append(title, meta, body, replyEditor, actions);
    list.append(row);
  });
}

async function saveFeedbackReply(item, adminReply, control) {
  control.disabled = true;
  try {
    await api(`/api/admin/feedback/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: item.status === "new" ? "read" : item.status,
        isPublic: Number(item.is_public) === 1,
        adminReply
      })
    });
    await loadFeedback();
    await loadDashboard();
  } catch (error) {
    alert(`站长回复保存失败：${error.message}`);
  } finally {
    control.disabled = false;
  }
}
async function clearFeedbackReply(item, control) {
  if (!confirm("确定清空这条站长回复吗？留言本身会保留。")) return;
  await saveFeedbackReply(item, "", control);
}
async function updateFeedback(item, status, isPublic) {
  await api(`/api/admin/feedback/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, isPublic })
  });
  await loadFeedback();
  await loadDashboard();
}
async function deleteFeedback(item) {
  if (!confirm("确定永久删除这条留言吗？")) return;
  await api(`/api/admin/feedback/${item.id}`, { method: "DELETE" });
  await loadFeedback();
  await loadDashboard();
}
