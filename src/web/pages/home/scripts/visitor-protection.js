    /*
     * 网站主体持续反机器人保护
     * --------------------------------------------------------
     * 这里只统计事件数量，不保存输入内容、鼠标坐标、文章正文或表单值。服务端
     * 只处理高置信度异常；没有操作、缓慢阅读和页面切到后台都不会触发拦截。
     */
    function emptyRuntimeSecurityCounters() {
      return { clicks: 0, keydowns: 0, scrolls: 0, navigations: 0, untrustedActions: 0, maxClickBurst: 0 };
    }

    function websiteShellIsVisible() {
      return !appShell.hidden && !state.runtimeSecurity.blocked;
    }

    function handleRuntimeBotDetected(message = "检测到异常自动化行为，当前页面已停止运行。") {
      const security = state.runtimeSecurity;
      if (security.blocked) return;
      security.blocked = true;
      window.SiteAgent?.close({ clear: true });
      stopRuntimeBotProtection({ preserveBlocked: true });
      state.auth = { authenticated: false, user: null };
      state.guestVerified = false;
      sessionStorage.setItem("xyj_runtime_blocked", "1");
      window.stop();
      document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
      appShell.inert = true;
      entryScreen.inert = true;
      const block = document.getElementById("runtime-security-block");
      document.getElementById("runtime-security-message").textContent = message;
      block.hidden = false;
      block.focus({ preventScroll: true });
      document.documentElement.style.overflow = "hidden";
      history.replaceState({ xingyuejiLayer: "security-blocked" }, "", "/?security=blocked");

      /*
       * 浏览器只允许脚本关闭由脚本打开的标签页。仍然调用 window.close()；
       * 若浏览器拒绝，无法交互的全屏拦截层会继续停留，不会暴露页面内容。
       */
      window.setTimeout(() => window.close(), 720);
    }

    function installRuntimeSecurityListeners() {
      const security = state.runtimeSecurity;
      if (security.listenersInstalled) return;
      security.listenersInstalled = true;

      document.addEventListener("click", (event) => {
        if (!websiteShellIsVisible()) return;
        const counters = security.counters;
        if (!event.isTrusted) {
          counters.untrustedActions += 1;
          if (counters.untrustedActions >= 4) sendRuntimeSecurityHeartbeat({ urgent: true });
          return;
        }
        counters.clicks += 1;
        const now = performance.now();
        security.recentClicks = security.recentClicks.filter((time) => now - time <= 1000);
        security.recentClicks.push(now);
        counters.maxClickBurst = Math.max(counters.maxClickBurst, security.recentClicks.length);
        if (counters.maxClickBurst >= 16) sendRuntimeSecurityHeartbeat({ urgent: true });
      }, true);

      document.addEventListener("keydown", (event) => {
        if (!websiteShellIsVisible()) return;
        /* 长按方向键会产生大量 repeat 事件，但这仍属于正常操作，不计入速率。 */
        if (!event.isTrusted) security.counters.untrustedActions += 1;
        else if (!event.repeat) security.counters.keydowns += 1;
      }, true);
      document.addEventListener("scroll", (event) => {
        if (!websiteShellIsVisible() || !event.isTrusted) return;
        /* 触控板一次手势可产生数百个 scroll 事件，按 80ms 合并避免误判。 */
        const now = performance.now();
        if (now - security.lastScrollAt >= 80) {
          security.lastScrollAt = now;
          security.counters.scrolls += 1;
        }
      }, { capture: true, passive: true });
    }

    async function sendRuntimeSecurityHeartbeat({ urgent = false } = {}) {
      const security = state.runtimeSecurity;
      if (!security.started || security.blocked || security.sending || !websiteShellIsVisible()) return;
      if (!urgent && document.visibilityState !== "visible") return;
      security.sending = true;
      const now = Date.now();
      const snapshot = { ...security.counters };
      try {
        await api("/api/security/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...snapshot,
            elapsedMs: Math.max(1, now - security.lastReportAt),
            webdriver: navigator.webdriver === true,
          }),
        });
        security.counters = emptyRuntimeSecurityCounters();
        security.recentClicks = [];
        security.lastReportAt = now;
      } catch (error) {
        /* BOT_DETECTED 已由 api() 统一显示拦截层；普通断网不应中断阅读。 */
        if (error.code !== "BOT_DETECTED") console.warn("Runtime security heartbeat unavailable", error.message);
      } finally {
        security.sending = false;
      }
    }

    function startRuntimeBotProtection() {
      const security = state.runtimeSecurity;
      if (security.blocked || security.started) return;
      installRuntimeSecurityListeners();
      security.started = true;
      security.lastReportAt = Date.now();
      security.counters = emptyRuntimeSecurityCounters();
      security.recentClicks = [];
      security.lastScrollAt = 0;
      security.firstCheckId = window.setTimeout(
        () => sendRuntimeSecurityHeartbeat({ urgent: navigator.webdriver === true }),
        navigator.webdriver === true ? 900 : 12_000,
      );
      security.intervalId = window.setInterval(() => sendRuntimeSecurityHeartbeat(), 45_000);
    }

    function stopRuntimeBotProtection({ preserveBlocked = false } = {}) {
      const security = state.runtimeSecurity;
      window.clearTimeout(security.firstCheckId);
      window.clearInterval(security.intervalId);
      security.firstCheckId = null;
      security.intervalId = null;
      security.started = false;
      security.sending = false;
      security.counters = emptyRuntimeSecurityCounters();
      security.recentClicks = [];
      security.lastScrollAt = 0;
      if (!preserveBlocked) security.blocked = false;
    }
