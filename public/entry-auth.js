/* Login drafts belong only to this tab. Never persist a password in localStorage
 * or a URL; discard it after successful entry and expire abandoned drafts. */
(() => {
  "use strict";
  const DRAFT_KEY = "xyj_entry_form_draft";
  const DRAFT_TTL = 30 * 60 * 1000;
  const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  let scriptPromise = null;

  function installFormDraft(form) {
    const username = form.querySelector('[name="username"]');
    const password = form.querySelector('[name="password"]');
    const remember = form.querySelector('[name="remember"]');
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (draft?.version === 1 && draft.expiresAt > Date.now()) {
        // Browser/password-manager autofill takes precedence over a draft.
        if (!username.value) username.value = String(draft.username || "");
        if (!password.value) password.value = String(draft.password || "");
        remember.checked = Boolean(draft.remember);
      } else sessionStorage.removeItem(DRAFT_KEY);
    } catch { /* Native autocomplete remains usable when storage is blocked. */ }
    const save = () => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1,
          username: username.value, password: password.value, remember: remember.checked,
          expiresAt: Date.now() + DRAFT_TTL }));
      } catch { /* Storage restrictions must never prevent login. */ }
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    form.addEventListener("submit", save);
    window.addEventListener("pagehide", save);
    return Object.freeze({ clearPassword() { password.value = ""; save(); } });
  }

  function loadScript() {
    if (globalThis.turnstile?.render) return Promise.resolve(globalThis.turnstile);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "xyj-turnstile-script";
      script.src = SCRIPT_URL;
      script.async = true;
      let timer;
      const finish = error => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve(globalThis.turnstile);
      };
      script.onload = () => finish(globalThis.turnstile?.render ? null : new Error("人机验证组件未正确初始化"));
      script.onerror = () => finish(new Error("人机验证组件加载失败，请检查网络或拦截扩展"));
      timer = setTimeout(() => finish(new Error("验证加载较慢，可重新加载。")), 15_000);
      document.head.append(script);
    }).catch(error => { scriptPromise = null; throw error; });
    return scriptPromise;
  }

  function createChallenge({ loadConfig, onConfig, onToken, onNotice }) {
    const wrapper = document.getElementById("entry-verification");
    const host = document.getElementById("guest-turnstile");
    const status = document.getElementById("entry-verification-status");
    const retry = document.getElementById("entry-verification-retry");
    let promise = null, widgetId = null, generation = 0, controller = null, slowTimer = null;
    const message = (text, canRetry = false) => {
      status.textContent = text;
      status.hidden = !text;
      retry.hidden = !canRetry;
    };
    const stopTimer = () => { clearTimeout(slowTimer); slowTimer = null; };
    function initialize({ reload = false } = {}) {
      if (promise && !reload) return promise;
      if (reload) {
        controller?.abort();
        stopTimer();
        if (widgetId !== null) globalThis.turnstile?.remove(widgetId);
        widgetId = null;
        host.replaceChildren();
        onToken("");
      }
      const current = ++generation;
      const attemptController = new AbortController();
      controller = attemptController;
      const signal = attemptController.signal;
      wrapper.hidden = false;
      host.hidden = true;
      message("正在加载人机验证…");
      promise = (async () => {
        let configTimer;
        const config = await Promise.race([
          loadConfig(signal),
          new Promise((_, reject) => { configTimer = setTimeout(() => {
            reject(new Error("验证加载较慢，可重新加载。")); attemptController.abort();
          }, 12_000); }),
        ]).finally(() => clearTimeout(configTimer));
        if (current !== generation) return promise;
        onConfig(config);
        if (!config.enabled) {
          wrapper.hidden = true;
          if (config.incomplete) {
            const missing = config.missingSiteKey ? "TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY";
            onNotice?.(`人机验证暂缺 ${missing}，当前由访问频率限制保护，仍可进入游客模式。`);
          }
          return config;
        }
        const turnstile = await loadScript();
        if (current !== generation) return promise;
        host.hidden = false;
        const compact = host.clientWidth > 0 && host.clientWidth < 300;
        host.classList.toggle("is-compact", compact);
        slowTimer = setTimeout(() => {
          if (current === generation) message("验证加载较慢，可重新加载。", true);
        }, 12_000);
        const update = (token, text, canRetry = false) => {
          if (current !== generation) return;
          stopTimer(); onToken(token); message(text, canRetry);
        };
        widgetId = turnstile.render(host, {
          sitekey: config.siteKey, action: config.action || "guest_entry",
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          size: compact ? "compact" : "flexible",
          callback: token => update(token, "人机验证已通过，可以登录或进入游客模式。"),
          "before-interactive-callback": () => {
            if (current === generation) { stopTimer(); message("请完成人机验证。"); }
          },
          "expired-callback": () => update("", "验证已过期，请重新完成验证。", true),
          "timeout-callback": () => update("", "验证等待超时，请重试。", true),
          "error-callback": () => update("", "人机验证加载失败，请重试。", true),
        });
        return config;
      })().catch(error => {
        if (current !== generation) return promise;
        if (current === generation) {
          stopTimer(); onToken(""); message(error.message, true); promise = null;
        }
        throw error;
      });
      return promise;
    }
    retry.addEventListener("click", () => initialize({ reload: true }).catch(() => {}));
    return Object.freeze({ initialize, reset() {
      onToken("");
      if (widgetId !== null && globalThis.turnstile) {
        message("请完成人机验证。");
        globalThis.turnstile.reset(widgetId);
      }
    } });
  }
  window.XYJEntryAuth = Object.freeze({ installFormDraft, createChallenge });
})();
