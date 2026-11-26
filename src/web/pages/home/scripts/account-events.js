    /* ---------- 14. 账户中心：修改昵称、密码、退出和在线心跳。 ---------- */
    document.getElementById("nickname-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector("button[type='submit']");
      const notice = document.getElementById("nickname-notice");
      submit.disabled = true; notice.textContent = "正在保存…";
      try {
        const result = await api("/api/auth/profile", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: document.getElementById("account-nickname").value }),
        });
        state.auth.user = result.user; renderAccount(); notice.textContent = "昵称已更新。";
      } catch (error) { notice.textContent = error.message; }
      finally { submit.disabled = false; }
    });

    document.getElementById("password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentPassword = document.getElementById("current-password");
      const newPassword = document.getElementById("new-password");
      const confirmPassword = document.getElementById("new-password-confirm");
      const notice = document.getElementById("password-notice");
      if (newPassword.value !== confirmPassword.value) { notice.textContent = "两次输入的新密码不一致。"; return; }
      if (!/\p{L}/u.test(newPassword.value) || !/\p{N}/u.test(newPassword.value)) { notice.textContent = "新密码至少需要包含一个字母和一个数字。"; return; }
      const submit = event.currentTarget.querySelector("button[type='submit']");
      submit.disabled = true; notice.textContent = "正在修改密码…";
      try {
        await api("/api/auth/change-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
        });
        event.currentTarget.reset(); notice.textContent = "密码已修改，其他设备上的登录已经失效。";
      } catch (error) { notice.textContent = error.message; }
      finally { submit.disabled = false; }
    });

    document.getElementById("account-logout").addEventListener("click", async () => {
      window.SiteAgent?.close({ clear: true });
      await api("/api/auth/logout", { method: "POST" }).catch(() => null);
      localStorage.removeItem("xyj_entry_mode");
      sessionStorage.removeItem("xyj_guest_handoff");
      location.replace("/");
    });

    document.getElementById("auth-login-link").addEventListener("click", (event) => {
      if (!state.auth.authenticated) return;
      event.preventDefault(); document.getElementById("auth-lock-dialog").close(); navigateSection("settings");
    });

    /* hashchange 兼容手工修改地址；入口层不应被地址中的旧 hash 切回网站主体。 */
    window.addEventListener("hashchange", () => {
      if (history.state?.xingyuejiLayer === ENTRY_HISTORY_LAYER) return;
      const target = location.hash.slice(1);
      if (target === "portfolio" || target.startsWith("portfolio/")) {
        if (state.activeSection === "portfolio" && personalSpaceHash() === target) return;
        personalSpaceRestoreLocation(); navigateSection("portfolio", { historyMode: "none", animate: false, preservePortfolio: true }); return;
      }
      if (document.getElementById(target)?.classList.contains("content-section")) navigateSection(target, { historyMode: "none" });
    });
    window.addEventListener("popstate", (event) => {
      if (event.state?.xingyuejiLayer === ENTRY_HISTORY_LAYER) {
        state.entryRequestedSection = state.activeSection || "home";
        document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
        showEntryScreen();
        return;
      }
      const target = event.state?.xingyuejiSection || location.hash.slice(1);
      const section = target.startsWith("portfolio/") ? "portfolio" : target;
      if (document.getElementById(section)?.classList.contains("content-section")) {
        showWebsiteShell();
        if (section === "portfolio") personalSpaceRestoreLocation();
        navigateSection(section, { historyMode: "none", animate: false, preservePortfolio: true });
      }
    });

    async function refreshAuthPresence() {
      try {
        const before = `${state.auth.user?.status || "guest"}:${state.auth.user?.nickname || ""}`;
        const session = await api("/api/auth/session");
        state.auth = session;
        const after = `${session.user?.status || "guest"}:${session.user?.nickname || ""}`;
        renderAccount();
        if (before !== after) {
          state.data = await loadBootstrap({ fresh: true });
          renderPortfolio(); renderResources();
        }
      } catch { /* 心跳失败不打断访客当前正在阅读的页面。 */ }
    }
    window.setInterval(refreshAuthPresence, 60_000);
