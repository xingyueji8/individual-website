    /* ---------- 07. 普通用户账户状态、昵称和密码。 ---------- */
    function renderAccount() {
      const user = state.auth.user;
      const navButton = document.getElementById("account-nav-button");
      const navLabel = document.getElementById("account-nav-label");
      // “设置”对游客也可见，登录后在同一板块内增加账号管理。
      navButton.hidden = false;
      navLabel.textContent = document.documentElement.lang === "en" ? "Settings"
        : (document.documentElement.lang === "zh-TW" ? "設定" : "设置");
      const accessNote = document.getElementById("portfolio-access-note");
      accessNote.textContent = hasFullAccess() ? "已显示个人空间完整内容" : "游客或待审核账号仅显示公开内容";
      const registered = Boolean(user);
      document.getElementById("comment-form").hidden = !registered;
      document.getElementById("comment-auth-required").hidden = registered;
      document.getElementById("feedback-form").hidden = !registered;
      document.getElementById("feedback-auth-required").hidden = registered;
      document.getElementById("content-like").hidden = !registered;
      document.getElementById("content-dislike").hidden = !registered;
      const commentName = document.getElementById("guest-name");
      if (commentName) {
        commentName.readOnly = Boolean(user);
        if (user) commentName.value = user.nickname;
      }
      // 登录状态可能由定时心跳更新，下载入口也要立即跟随权限变化。
      syncProtectedDownloadControls();
      if (!user) return;

      const status = document.getElementById("account-status");
      status.textContent = accountStatusLabels[user.status] || user.status;
      status.className = `account-status ${user.status}`;
      const notes = {
        pending: "注册申请已经提交。审核完成前仍可浏览公开内容。",
        approved: "账号已获得完整权限，可以使用 AI 助手并查看会员内容。",
        rejected: "本次申请未通过审核，你可以通过留言与反馈联系站长。",
        disabled: "账号已被停用，请联系站长。",
      };
      document.getElementById("account-status-note").textContent = notes[user.status] || "";
      document.getElementById("account-username").textContent = user.username;
      document.getElementById("account-current-nickname").textContent = user.nickname;
      document.getElementById("account-created-at").textContent = formatDate(user.createdAt) || "—";
      document.getElementById("account-last-login").textContent = formatDate(user.lastLoginAt) || "—";
      document.getElementById("account-nickname").value = user.nickname;

      // 评论和留言统一使用当前账号昵称，不再允许游客署名。
      if (!document.getElementById("guest-name").value) document.getElementById("guest-name").value = user.nickname;
      if (!document.getElementById("feedback-name").value) document.getElementById("feedback-name").value = user.nickname;
    }
