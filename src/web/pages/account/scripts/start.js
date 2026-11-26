    /* ---------- 已登录状态 ---------- */
    const statusLabels = { pending: "等待审核", approved: "已通过审核", rejected: "审核未通过", disabled: "账号已停用" };
    async function initialize() {
      if (resetToken) { await prepareResetPanel(); return; }
      /*
       * 旧书签或旧页面仍可能访问 /login?mode=login。统一跳回根页面后，
       * 浏览器只会显示 index.html 中那一套全屏登录框。
       */
      if (!["register", "forgot"].includes(requestedMode)) {
        location.replace(canonicalLoginPath);
        return;
      }
      try {
        const session = await api("/api/auth/session");
        if (session.authenticated) {
          document.getElementById("signed-nickname").textContent = session.user.nickname;
          document.getElementById("signed-username").textContent = session.user.username;
          const status = document.getElementById("signed-status");
          status.textContent = statusLabels[session.user.status] || session.user.status;
          status.className = `status-badge ${session.user.status}`;
          document.getElementById("signed-enter").href = nextPath;
          showPanel("signed"); return;
        }
      } catch { /* 会话检查失败时仍允许显示普通登录表单。 */ }
      showPanel(requestedMode);
    }

    document.getElementById("signed-logout").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => null);
      localStorage.removeItem("xyj_entry_mode");
      sessionStorage.removeItem("xyj_guest_handoff");
      location.replace("/");
    });

    updateRegisterStep(1);
    initializePhotoBackground();
    initialize();
