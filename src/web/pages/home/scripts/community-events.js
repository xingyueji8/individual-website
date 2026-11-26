    /* ---------- 15. 游客评论表单。 ---------- */
    document.getElementById("guest-name").value = localStorage.getItem("xyj_guest_name") || "";
    document.getElementById("comment-form").addEventListener("submit", async (event) => {
      event.preventDefault(); if (!state.currentContent) return;
      if (!state.auth.authenticated) { showAuthLock("account"); return; }
      const name = document.getElementById("guest-name"); const body = document.getElementById("comment-body"); const notice = document.getElementById("comment-notice");
      notice.textContent = "正在发表…";
      try {
        localStorage.setItem("xyj_guest_name", name.value.trim());
        await api("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId: state.currentContent.id, guestName: name.value, body: body.value }) });
        body.value = ""; notice.textContent = "评论已发表。";
        const data = await api(`/api/comments?contentId=${encodeURIComponent(state.currentContent.id)}`); state.comments = data.comments; renderComments();
      } catch (error) { notice.textContent = error.message; }
    });

    /* ---------- 16. 游客留言与反馈表单。 ---------- */
    document.getElementById("feedback-name").value = localStorage.getItem("xyj_guest_name") || "";
    document.getElementById("feedback-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.auth.authenticated) { showAuthLock("account"); return; }
      const submit = event.currentTarget.querySelector("button[type='submit']");
      const notice = document.getElementById("feedback-notice");
      const guestName = document.getElementById("feedback-name").value.trim();
      const isPublic = document.getElementById("feedback-public").checked;
      submit.disabled = true; notice.textContent = "正在提交…";
      try {
        localStorage.setItem("xyj_guest_name", guestName);
        await api("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestName,
            contact: document.getElementById("feedback-contact").value,
            category: document.getElementById("feedback-category").value,
            body: document.getElementById("feedback-body").value,
            isPublic,
          }),
        });
        document.getElementById("feedback-body").value = "";
        notice.textContent = "已提交，站长后台会显示这条信息。";
        if (isPublic) {
          const data = await api("/api/feedback"); state.publicFeedback = data.feedback || []; renderFeedback();
        }
      } catch (error) {
        notice.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
