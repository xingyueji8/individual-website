document.getElementById("changelog-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("changelog-id").value;
  const notice = document.getElementById("changelog-notice");
  const date = document.getElementById("changelog-date").value;
  try {
    await api(id ? `/api/admin/changelogs/${id}` : "/api/admin/changelogs", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: document.getElementById("changelog-version").value,
        title: document.getElementById("changelog-title").value,
        body: document.getElementById("changelog-body").value,
        publishedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
        sortOrder: Number(document.getElementById("changelog-sort").value || 0)
      })
    });
    notice.textContent = "更新记录已保存，精确时间、顺序和网页版本号已同步。";
    resetChangelog();
    await loadChangelogs();
    await loadSettings();
    await loadDashboard();
  } catch (error) {
    notice.textContent = error.message;
  }
});
document.getElementById("new-changelog").addEventListener("click", resetChangelog);
document.getElementById("delete-changelog").addEventListener("click", async () => {
  const id = document.getElementById("changelog-id").value;
  if (!id || !confirm("确定删除这条更新记录吗？")) return;
  await api(`/api/admin/changelogs/${id}`, { method: "DELETE" });
  resetChangelog();
  await loadChangelogs();
  await loadSettings();
  await loadDashboard();
});
