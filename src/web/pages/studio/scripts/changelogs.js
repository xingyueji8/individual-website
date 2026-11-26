async function loadChangelogs() {
  app.changelogs = await api("/api/admin/changelogs");
  renderChangelogs();
}
function renderChangelogs() {
  const list = document.getElementById("changelog-list");
  clear(list);
  app.changelogs.forEach((item) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = `v${item.version} · ${item.title}`;
    const meta = document.createElement("div");
    meta.className = "list-meta";
    meta.textContent = `${formatDate(item.published_at)} · 排序 ${item.sort_order || 0}`;
    row.append(title, meta);
    row.addEventListener("click", () => editChangelog(item));
    list.append(row);
  });
}
function resetChangelog() {
  document.getElementById("changelog-form").reset();
  document.getElementById("changelog-id").value = "";
  document.getElementById("changelog-date").value = localDateTimeInput();
  document.getElementById("changelog-sort").value = "0";
  document.getElementById("delete-changelog").classList.add("hidden");
  document.getElementById("changelog-notice").textContent = "";
}
function editChangelog(item) {
  document.getElementById("changelog-id").value = item.id;
  document.getElementById("changelog-version").value = item.version;
  document.getElementById("changelog-title").value = item.title;
  document.getElementById("changelog-body").value = item.body;
  document.getElementById("changelog-date").value = localDateTimeInput(item.published_at);
  document.getElementById("changelog-sort").value = item.sort_order || 0;
  document.getElementById("delete-changelog").classList.remove("hidden");
}
