    /* ---------- 13. 事件绑定：导航、侧栏、头像和弹窗。 ---------- */
    // 图片切换按钮、助手和带独立动画的头像不参加通用回弹。
    installLiquidGlassControlMotion({
      selector: "button, a.btn, .tab-button, .studio-link, [role='button'], .content-card, .photo-card",
      ignore: ":disabled, .image-nav, .agent-pet",
      ignoreId: "avatar-refresh",
      durationFromStyle: true,
    });
    document.getElementById("entry-login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector("button[type='submit']");
      const notice = document.getElementById("entry-notice");
      submit.disabled = true;
      notice.textContent = "正在登录…";
      try {
        const protection = await initializeGuestProtection();
        if (protection.enabled && !state.turnstileToken) {
          notice.textContent = "请先完成人机验证。";
          return;
        }
        await api("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: document.getElementById("entry-username").value,
            password: document.getElementById("entry-password").value,
            remember: document.getElementById("entry-remember").checked,
            turnstileToken: state.turnstileToken,
          }),
        });
        notice.textContent = "登录成功，正在进入网站…";
        entryDraft.clearPassword();
        state.guestVerified = false;
        // 登录前缓存的是游客数据；清除后重新读取，才能显示该账号的会员内容。
        state.bootstrapPromise = null;
        state.siteLoaded = false;
        await boot();
        window.dispatchEvent(new CustomEvent("xyj-auth-changed"));
      } catch (error) {
        if (error.code === "GUEST_DAILY_LIMIT") {
          notice.textContent = "";
          const dialog = document.getElementById("guest-limit-dialog");
          if (!dialog.open) dialog.showModal();
        } else {
          notice.textContent = error.message;
        }
        resetGuestTurnstile();
      } finally {
        submit.disabled = false;
      }
    });

    document.getElementById("entry-guest").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const notice = document.getElementById("entry-notice");
      button.disabled = true;
      try {
        const protection = await initializeGuestProtection();
        if (protection.enabled && !state.turnstileToken) {
          notice.textContent = "请先完成人机验证。";
          return;
        }
        notice.textContent = protection.enabled
          ? "正在核验并进入游客模式…"
          : protection.incomplete
            ? "人机验证配置尚未补齐，正在通过访问频率限制进入…"
            : "正在以游客身份进入…";
        await api("/api/guest/enter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId, turnstileToken: state.turnstileToken }),
        });
        state.guestVerified = true;
        state.bootstrapPromise = null;
        state.siteLoaded = false;
        await boot({ enterAsGuest: true });
      } catch (error) {
        if (error.code === "GUEST_DAILY_LIMIT") {
          notice.textContent = "";
          const dialog = document.getElementById("guest-limit-dialog");
          if (!dialog.open) dialog.showModal();
        } else {
          notice.textContent = error.message;
        }
        resetGuestTurnstile();
      } finally { button.disabled = false; }
    });

    function animateNavigationIcon(button) {
      const icon = button.querySelector(".nav-icon");
      if (!icon || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      icon.classList.remove("nav-icon-activated");
      void icon.offsetWidth;
      icon.classList.add("nav-icon-activated");
      window.setTimeout(() => icon.classList.remove("nav-icon-activated"), 620);
    }
    document.querySelectorAll(".nav button[data-section]").forEach((button) => button.addEventListener("click", () => {
      animateNavigationIcon(button);
      personalSpaceActivate(button, () => navigateSection(button.dataset.section), 260);
    }));
    document.querySelectorAll("[data-login-required]").forEach((button) => button.addEventListener("click", () => showAuthLock("account")));
    document.getElementById("resource-up").addEventListener("click", async () => {
      const current = (state.data?.assetFolders || []).find((item) => item.id === state.currentResourceFolder);
      if (state.resourceRootLocked && current && !current.parent_id) return;
      try {
        if (current && await releaseViewGrants(`assetFolder:${current.id}`)) await refreshProtectedContent();
        state.currentResourceFolder = current?.parent_id || "";
        renderPortfolioPanel();
      } catch (error) { alert(error.message); }
    });
    document.getElementById("resource-folder-download").addEventListener("click", (event) => {
      const asset = (state.data?.assets || []).find((item) => item.id === event.currentTarget.dataset.assetId);
      if (!asset?.downloadUrl) { showAuthLock("download"); return; }
      location.href = protectedMediaUrl(asset.downloadUrl);
    });

    const sidebarToggle = document.getElementById("sidebar-toggle");
    const mobileSidebarLayout = matchMedia("(max-width: 760px) and (hover: none), (max-width: 760px) and (pointer: coarse)");
    function updateSidebarToggleIcon(collapsed) {
      sidebarToggle.textContent = mobileSidebarLayout.matches
        ? (collapsed ? "▼" : "▲")
        : (collapsed ? "☰" : "◀");
    }
    function setSidebarCollapsed(collapsed) {
      appShell.classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      sidebarToggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
      sidebarToggle.title = collapsed ? "展开侧边栏" : "收起侧边栏";
      updateSidebarToggleIcon(collapsed);
      localStorage.setItem("xyj_sidebar_collapsed", collapsed ? "1" : "0");
    }
    setSidebarCollapsed(localStorage.getItem("xyj_sidebar_collapsed") === "1");
    mobileSidebarLayout.addEventListener?.("change", () => updateSidebarToggleIcon(appShell.classList.contains("sidebar-collapsed")));
    sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!appShell.classList.contains("sidebar-collapsed")));
    installSidebarEdgeBounce();

    const updatesPreview = document.getElementById("updates-preview");
    updatesPreview.addEventListener("click", () => navigateSection("updates-history"));
    updatesPreview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigateSection("updates-history"); }
    });

    /*
     * 头像点击刷新：
     * 1. 保留 1.18 秒完整果冻形变；
     * 2. 动画进行到接近一半时便开始刷新，不再等待完整动画结束；
     * 3. 新页面启动时会自动移除这个临时参数。
     */
    document.getElementById("avatar-refresh").addEventListener("click", (event) => {
      const avatar = event.currentTarget;
      if (avatar.dataset.reloading === "true") return;
      avatar.dataset.reloading = "true";
      avatar.classList.remove("jelly");
      void avatar.offsetWidth;
      avatar.classList.add("jelly");

      // 1.18 秒动画的视觉中点约为 560ms；减少动态偏好的用户只等待 60ms。
      // replace 会保留当前板块 URL，因此刷新后仍停留在用户正在浏览的板块。
      let reloaded = false;
      const reloadAtJellyMidpoint = () => {
        if (reloaded) return;
        reloaded = true;
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set("_xyj_refresh", String(Date.now()));
        window.location.replace(refreshUrl.toString());
      };
      const refreshDelay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 560;
      window.setTimeout(reloadAtJellyMidpoint, refreshDelay);
    });
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => navigateSection(button.dataset.jump)));
    document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close()));
