document.getElementById("refresh-comments").addEventListener("click", loadComments);
document.getElementById("author-comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const contentId = document.getElementById("content-id").value;
  const input = document.getElementById("author-comment-body");
  if (!contentId || !input.value.trim()) return;
  await api("/api/admin/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId, body: input.value })
  });
  input.value = "";
  await loadComments();
  await loadDashboard();
});
document.getElementById("refresh-feedback").addEventListener("click", loadFeedback);
document.getElementById("feedback-open-tab").addEventListener("click", () => {
  app.feedbackArchive = false;
  renderAdminFeedback();
});
document.getElementById("feedback-archive-tab").addEventListener("click", () => {
  app.feedbackArchive = true;
  renderAdminFeedback();
});
document
  .getElementById("refresh-visitors")
  .addEventListener("click", () => loadGuestAnalytics().catch((error) => alert(error.message)));
document
  .getElementById("visitor-days")
  .addEventListener("change", () => loadGuestAnalytics().catch((error) => alert(error.message)));
document
  .getElementById("visitor-day")
  .addEventListener("change", () => loadGuestAnalytics().catch((error) => alert(error.message)));
document.getElementById("refresh-users").addEventListener("click", async () => {
  await loadUsers();
  await loadDashboard();
});
document.getElementById("studio-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("studio-message-input");
  if (!app.messagePeer || !input.value.trim()) return;
  await api("/api/admin/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientUserId: app.messagePeer.id, body: input.value })
  });
  input.value = "";
  await openStudioMessage(app.messagePeer.id);
  await loadStudioMessages();
});
