document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const notice = document.getElementById("login-notice");
  notice.textContent = "正在登录…";
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value })
    });
    showStudio();
    await loadAll();
  } catch (error) {
    notice.textContent = error.message;
  }
});
document
  .querySelectorAll(".side-nav button")
  .forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
document.getElementById("logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
});
