    /* ---------- 12. 页面启动：先显示身份入口，通过后才读取并展示网站。 ---------- */
    async function boot({ enterAsGuest = false } = {}) {
      try {
        const requestedBeforeEntry = state.entryRequestedSection || requestedSectionFromLocation();
        const session = await api("/api/auth/session").catch(() => ({ authenticated: false, user: null }));
        state.auth = session;
        if (showAndroidApproval(session)) return;

        /*
         * 旧版曾把游客选择永久写入 localStorage，导致以后访问都会绕过登录首页。
         * 新版主动清除该标记，并且不持久保存根页面的游客选择：游客刷新后会重新
         * 回到全屏入口；账号只要服务器会话仍有效，就可以直接进入网站。
         */
        localStorage.removeItem("xyj_entry_mode");
        const guestHandoff = sessionStorage.getItem("xyj_guest_handoff") === "1";
        if (guestHandoff) sessionStorage.removeItem("xyj_guest_handoff");

        if (!session.authenticated && !enterAsGuest && !guestHandoff) {
          state.entryRequestedSection = requestedBeforeEntry;
          replaceWithEntryHistory();
          showEntryScreen();
          return;
        }

        /*
         * 先在仍隐藏的主体中选中网址 hash 对应板块，再显示页面。这样浏览器
         * 第一次绘制网站主体时就是目标板块，不会先画主页、再跳到所选板块。
         */
        const initialSection = initialSectionState(requestedBeforeEntry);
        state.entryRequestedSection = "";
        showSection(initialSection.target, { animate: false });
        showWebsiteShell();
        activateWebsiteHistory(initialSection.target);
        if (state.siteLoaded) {
          renderAccount();
          if (initialSection.blocked) showAuthLock(initialSection.requested === "ai-helper" ? "ai" : "account");
          return;
        }
        const [bootstrap, feedbackData] = await Promise.all([
          loadBootstrap(),
          api("/api/feedback").catch(() => ({ feedback: [] })),
        ]);
        state.data = bootstrap;
        state.publicFeedback = feedbackData.feedback || [];
        state.siteLoaded = true;
        applySettings(); renderChangelogs(); renderPortfolio(); renderResources(); renderFeedback(); renderAccount();
        if (initialSection.target === "portfolio") playPersonalSpaceEntrance();
        if (initialSection.target !== "home") scheduleGuestSectionTrack(initialSection.target);

        /*
         * 上面的 initialSection 已在网站主体显示前完成恢复。此处仅处理权限
         * 提示，不再二次切换板块，避免数据加载完成后又产生一次视觉跳转。
         */
        if (initialSection.blocked) {
          showAuthLock(initialSection.requested === "ai-helper" ? "ai" : "account");
        }
      } catch (error) {
        // 已经选择身份后即使数据读取失败，也显示网站主体中的明确错误提示。
        showWebsiteShell();
        document.getElementById("timeline").replaceChildren(empty(`网站数据暂时无法读取：${error.message}`));
        document.getElementById("timeline-history").replaceChildren(empty("数据服务尚未完成部署。"));
        document.getElementById("portfolio-panel-host").replaceChildren(empty("数据服务尚未完成部署。"));
        document.getElementById("resource-grid").replaceChildren(empty("文件服务暂时不可用。"));
        document.getElementById("feedback-list").replaceChildren(empty("留言服务暂时不可用。"));
      }
    }
