    // Approve on the website using its own browser session. The code is usable
    // only by the App that holds the secret corresponding to this challenge.
    const androidRequest = new URLSearchParams(location.search);
    const androidChallenge = androidRequest.get("app_challenge") || "";
    const androidState = androidRequest.get("app_state") || "";
    const androidLoginRequested = !document.documentElement.hasAttribute("data-android-app")
      && /^[a-f0-9]{64}$/.test(androidChallenge) && /^[a-f0-9]{64}$/.test(androidState);

    function showAndroidApproval(session) {
      if (!androidLoginRequested || !session.authenticated || !session.user) return false;
      showEntryScreen({ verify: false });
      document.getElementById("entry-title").textContent = "登录星月集 App";
      document.getElementById("entry-login-form").hidden = true;
      document.getElementById("android-approval").hidden = false;
      document.getElementById("android-approval-account").textContent =
        `使用「${session.user.username}」登录 App？请确认这是你刚才从星月集 App 发起的请求。`;
      return true;
    }

    if (androidLoginRequested) {
      document.getElementById("entry-guest").hidden = true;
      const button = document.getElementById("android-approve");
      const status = document.getElementById("android-approval-status");
      const returnLink = document.getElementById("android-return");
      button.addEventListener("click", async () => {
        button.disabled = true;
        returnLink.hidden = true;
        status.textContent = "正在授权…";
        try {
          const { code } = await api("/api/auth/app/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challenge: androidChallenge }),
          });
          if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("授权结果无效");
          const fragment = new URLSearchParams({ code, state: androidState });
          // An explicit package preserves the back-to-app action in Android
          // browsers that keep ordinary same-site HTTPS links in the current tab.
          returnLink.href = `intent://${location.host}/app-signin/return?${fragment}#Intent;scheme=https;package=cn.com.xingyueji.offline;end`;
          returnLink.hidden = false;
          status.textContent = "授权成功，请在两分钟内返回 App。";
          button.textContent = "重新授权";
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
    }
