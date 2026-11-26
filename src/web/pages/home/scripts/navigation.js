    /* ---------- 03. 主导航：显示指定 section，并把站内切换写入浏览器历史。 ---------- */
    function showSection(id, { animate = true } = {}) {
      const target = document.getElementById(id);
      if (!target?.classList.contains("content-section")) return false;
      const sectionChanged = state.activeSection !== id || !target.classList.contains("active");
      document.querySelectorAll(".content-section").forEach((section) => {
        section.classList.toggle("active", section.id === id);
        section.classList.remove("section-entering");
      });
      document.querySelectorAll(".nav button[data-section]").forEach((button) => button.classList.toggle("active", button.dataset.section === id));
      /* 切换板块时直接回到顶部，避免 smooth 滚动与入场动画叠加造成拖沓感。 */
      target.scrollTop = 0;
      if (animate && sectionChanged && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        /*
         * active 与 section-entering 在同一轮样式计算前写入即可启动动画；不再
         * 读取 offsetWidth 强制同步排版，文字很多的主页也不会因此卡住主线程。
         */
        target.classList.add("section-entering");
        window.clearTimeout(target._sectionEnteringTimer);
        target._sectionEnteringTimer = window.setTimeout(() => target.classList.remove("section-entering"), 220);
      }
      state.activeSection = id;
      return true;
    }

    function requestedSectionFromLocation() {
      const requested = location.hash.slice(1);
      if (requested === "portfolio" || requested.startsWith("portfolio/")) return "portfolio";
      if (requested === "account") return "settings";
      if (requested === "resources") { personalSpaceRoute = { category: "resources", sectionId: "section-resources", subsectionId: "", all: true }; return "portfolio"; }
      if (requested === "contact") return "about";
      return document.getElementById(requested)?.classList.contains("content-section") ? requested : "home";
    }

    /* 根据已读取的会话决定刷新首帧能否直接恢复目标板块。 */
    function initialSectionState(requested = requestedSectionFromLocation()) {
      const blocked = (requested === "ai-helper" && !hasFullAccess())
        || (requested === "account" && !state.auth.authenticated);
      return { requested, target: blocked ? "home" : requested, blocked };
    }

    function updateSectionHistory(id, mode = "push") {
      if (mode === "none") return;
      const url = new URL(location.href);
      url.hash = id === "portfolio" ? personalSpaceHash() : id;
      const value = { xingyuejiLayer: APP_HISTORY_LAYER, xingyuejiSection: id };
      const address = `${url.pathname}${url.search}${url.hash}`;
      if (mode === "replace") history.replaceState(value, "", address);
      else if (history.state?.xingyuejiSection !== id || location.hash !== url.hash) history.pushState(value, "", address);
    }

    /* 同一游客的页面切换合并为短延迟写入，快速连点不会向 D1 产生重复请求。 */
    function scheduleGuestSectionTrack(section) {
      if (!state.guestVerified || state.auth.authenticated) return;
      window.clearTimeout(state.guestTrackTimer);
      state.guestTrackTimer = window.setTimeout(() => {
        api("/api/guest/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section }),
        }).catch(() => { /* 统计失败不应打断游客浏览。 */ });
      }, 420);
    }

    function navigateSection(id, { historyMode = "push", animate = true, preservePortfolio = false } = {}) {
      if (id === "account") id = "settings";
      if (id === "resources") { personalSpaceRoute = { category: "resources", sectionId: "section-resources", subsectionId: "", all: true }; preservePortfolio = true; id = "portfolio"; }
      if (id === "contact") id = "about";
      if (id === "ai-helper" && !hasFullAccess()) { showAuthLock("ai"); return; }
      if (id === "account" && !state.auth.authenticated) { showAuthLock("account"); return; }
      const leavingPortfolio = state.activeSection === "portfolio" && id !== "portfolio";
      if (id === "portfolio" && !preservePortfolio) personalSpaceNavigate({}, { historyMode: "none", focus: false });
      if (showSection(id, { animate })) {
        if (leavingPortfolio) { stopPersonalSpaceContent(); closeProtectedView(""); }
        if (id === "portfolio") { renderPersonalSpace(); if (animate) playPersonalSpaceEntrance(); }
        if (state.runtimeSecurity.started) state.runtimeSecurity.counters.navigations += 1;
        updateSectionHistory(id, historyMode);
        scheduleGuestSectionTrack(id);
      }
    }
