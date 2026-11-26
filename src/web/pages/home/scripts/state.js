    /* ---------- 01. 页面状态：保存从服务器读取的数据和当前打开的内容。 ---------- */
    const state = {
      data: null,
      auth: { authenticated: false, user: null },
      siteLoaded: false,
      currentContent: null,
      comments: [],
      activePortfolioSection: null,
      activeAlbums: {},
      activeSubsections: {},
      resourcePanelNode: null,
      imageSequence: [],
      currentImageIndex: -1,
      imageTargetIndex: -1,
      imageRequestId: 0,
      imageZoom: {
        scale: 1,
        x: 0,
        y: 0,
        pointers: new Map(),
        dragStart: null,
        pinchStart: null,
      },
      // Keep a small, retryable preload set; actual reuse revalidates permissions.
      preloadedImages: new Map(),
      publicFeedback: [],
      pdfDownloading: false,
      pdfLibraryPromise: null,
      bootstrapPromise: null,
      entryBackgroundStarted: false,
      guestProtection: { enabled: false, incomplete: false, siteKey: "", action: "guest_entry" },
      turnstileToken: "",
      guestVerified: false,
      guestTrackTimer: null,
      runtimeSecurity: {
        started: false,
        blocked: false,
        sending: false,
        listenersInstalled: false,
        intervalId: null,
        firstCheckId: null,
        lastReportAt: 0,
        lastScrollAt: 0,
        recentClicks: [],
        counters: { clicks: 0, keydowns: 0, scrolls: 0, navigations: 0, untrustedActions: 0, maxClickBurst: 0 },
      },
      // 从入口进入网站前暂存深链接板块；入口 URL 本身保持干净，不携带 #hash。
      entryRequestedSection: "",
      activeSection: "home",
      currentResourceFolder: "",
      resourceRootLocked: false,
      activeResourceAsset: null,
      activeResourceVideo: null,
      hlsPlayer: null,
      hlsLibraryPromise: null,
    };

    // 两层界面的根节点：入口层和真正的网站主体永远只显示其中一个。
    const entryScreen = document.getElementById("entry-screen");
    const appShell = document.querySelector(".app-shell");
    const ENTRY_HISTORY_LAYER = "entry";
    const APP_HISTORY_LAYER = "app";
    const entryDraft = window.XYJEntryAuth.installFormDraft(document.getElementById("entry-login-form"));
    const entryChallenge = window.XYJEntryAuth.createChallenge({
      loadConfig: signal => api("/api/guest/config", { signal }),
      onConfig: config => { state.guestProtection = config; },
      onToken: token => { state.turnstileToken = token; },
      onNotice: text => { document.getElementById("entry-notice").textContent = text; },
    });

    function showEntryScreen() {
      window.SiteAgent?.close({ clear: true });
      if (state.runtimeSecurity.blocked) return;
      stopRuntimeBotProtection();
      entryScreen.hidden = false;
      appShell.hidden = true;
      document.body.classList.add("entry-active");
      initializeGuestProtection().catch((error) => {
        document.getElementById("entry-notice").textContent = error.message;
      });
    }

    function showWebsiteShell() {
      if (state.runtimeSecurity.blocked) return;
      entryScreen.hidden = true;
      appShell.hidden = false;
      document.body.classList.remove("entry-active");
      startRuntimeBotProtection();
    }

    /*
     * 根页面实际上包含两层界面：登录/游客选择层与网站主体层。过去进入网站时
     * 直接 replaceState，入口历史记录被主体覆盖，所以从主页回退会离开网站。
     * 现在入口固定为第一条记录，主体作为下一条记录：
     *   入口（entry） → 网站板块（app） → 后续板块（app）
     * 这样回退到最后一个站内板块之后会回到入口，继续回退才离开本站；前进
     * 操作则能恢复网站主体和原来的板块。
     */
    function cleanHistoryAddress(section = "") {
      const url = new URL(location.href);
      url.searchParams.delete("_xyj_refresh");
      url.searchParams.delete("login");
      url.hash = section ? `#${section}` : "";
      return `${url.pathname}${url.search}${url.hash}`;
    }

    function replaceWithEntryHistory() {
      history.replaceState({ xingyuejiLayer: ENTRY_HISTORY_LAYER }, "", cleanHistoryAddress());
    }

    function activateWebsiteHistory(section) {
      const value = { xingyuejiLayer: APP_HISTORY_LAYER, xingyuejiSection: section };
      const address = cleanHistoryAddress(section === "portfolio" ? personalSpaceHash() : section);
      if (history.state?.xingyuejiLayer === ENTRY_HISTORY_LAYER) {
        history.pushState(value, "", address);
      } else if (history.state?.xingyuejiLayer === APP_HISTORY_LAYER) {
        history.replaceState(value, "", address);
      } else {
        // 首次打开时如果账号会话仍然有效，也补出一个可以回退到的入口节点。
        replaceWithEntryHistory();
        history.pushState(value, "", address);
      }
    }

    /*
     * _xyj_refresh 用于头像强制刷新，login=1 用于从站内受限功能重新打开
     * 首页登录层。页面完成重新载入后即可清理，两者都不需要长期留在地址栏。
     */
    const initialUrl = new URL(window.location.href);
    const transientParameters = ["_xyj_refresh", "login"];
    const hasTransientParameter = transientParameters.some((name) => initialUrl.searchParams.has(name));
    if (hasTransientParameter) {
      transientParameters.forEach((name) => initialUrl.searchParams.delete(name));
      history.replaceState(history.state, "", `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);
    }
