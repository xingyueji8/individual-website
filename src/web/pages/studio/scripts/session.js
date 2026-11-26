async function checkSession() {
  try {
    await api("/api/admin/session");
  } catch {
    document.getElementById("login-shell").classList.remove("hidden");
    return;
  }
  showStudio();
  await loadAll();
}
function showStudio() {
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("studio").classList.remove("hidden");
}
