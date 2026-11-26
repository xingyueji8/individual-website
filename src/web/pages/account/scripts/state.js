    /* ========================================================
       注册与账户帮助页 JavaScript
       负责切换面板、三步注册、找回密码和一次性密码重置。
       登录与游客入口只存在于网站根页面，避免维护两套外观不同的登录框。
       ======================================================== */
    const params = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    const resetToken = fragment.get("reset") || params.get("reset") || "";
    if (resetToken) {
      const clean = new URL(location.href);
      clean.searchParams.delete("reset");
      if (fragment.has("reset")) clean.hash = "";
      history.replaceState(null, "", clean.href);
    }
    const requestedMode = params.get("mode") || "login";
    const requestedNext = params.get("next") || "/";

    /* 只允许跳转到本站内部路径，阻止 next 参数把用户带到外部网站。 */
    let nextPath = "/";
    try {
      const target = new URL(requestedNext, location.origin);
      if (requestedNext.startsWith("/") && target.origin === location.origin) nextPath = target.href;
    } catch { /* Invalid return destination: go home. */ }
    const nextHash = new URL(nextPath, location.origin).hash;
    const canonicalLoginPath = `/?login=1${nextHash}`;
    let registerStep = 1;

    async function api(path, options = {}) {
      const response = await fetch(path, options);
      const type = response.headers.get("content-type") || "";
      const data = type.includes("application/json") ? await response.json() : null;
      if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
      return data;
    }
