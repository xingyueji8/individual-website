async function loadAll() {
  await loadStudioContentData({ initial: true });
  await Promise.allSettled([
    loadDashboard(),
    loadChangelogs(),
    loadComments(),
    loadFeedback(),
    loadGuestAnalytics(),
    loadSettings()
  ]);
  try {
    await showPendingUploadNotice();
  } catch (error) {
    console.warn("续传列表暂时无法加载", error.message);
  }
}
async function loadDashboard() {
  const data = await api("/api/admin/dashboard");
  const stats = document.getElementById("stats");
  clear(stats);
  [
    ["今日游客人次", data.guestVisitorsToday],
    ["今日浏览", data.guestPageViewsToday],
    ["大板块", data.sections],
    ["全部内容", data.content],
    ["已发布", data.published],
    ["注册用户", data.users],
    ["待审核", data.pendingUsers],
    ["当前在线", data.onlineUsers],
    ["重置申请", data.resetRequests],
    ["评论", data.comments],
    ["图片", data.media],
    ["文件资源", data.assets],
    ["更新记录", data.changelogs],
    ["新留言", data.unreadFeedback],
    ["全部留言", data.feedback]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat";
    const s = document.createElement("span");
    s.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    card.append(s, strong);
    stats.append(card);
  });
}
