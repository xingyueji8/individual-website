    /* ---------- 忘记密码与一次性重置链接 ---------- */
    document.getElementById("forgot-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector("button[type='submit']");
      const notice = document.getElementById("forgot-notice");
      submit.disabled = true; setNotice(notice, "正在提交…");
      try {
        const result = await api("/api/auth/forgot-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: document.getElementById("forgot-username").value,
            contactType: document.getElementById("forgot-contact-type").value,
            contact: document.getElementById("forgot-contact").value,
          }),
        });
        setNotice(notice, result.message, "success");
        event.currentTarget.reset();
      } catch (error) { setNotice(notice, error.message, "error"); }
      finally { submit.disabled = false; }
    });

    async function prepareResetPanel() {
      showPanel("reset");
      const description = document.getElementById("reset-description");
      const form = document.getElementById("reset-form");
      const back = document.getElementById("reset-back");
      try {
        const info = await api("/api/auth/password-reset-info", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken }) });
        if (!info.valid) throw new Error("链接无效、已使用或已过期，请重新申请密码重置。");
        description.textContent = `正在为“${info.nickname}”重置密码。本链接将在24小时内失效，且只能使用一次。`;
        form.hidden = false;
      } catch (error) {
        description.textContent = error.message; back.hidden = false;
      }
    }

    document.getElementById("reset-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = document.getElementById("reset-password").value;
      const confirmPassword = document.getElementById("reset-password-confirm").value;
      const notice = document.getElementById("reset-notice");
      if (password !== confirmPassword) { setNotice(notice, "两次输入的密码不一致。", "error"); return; }
      if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) { setNotice(notice, "新密码至少需要包含一个字母和一个数字。", "error"); return; }
      const submit = event.currentTarget.querySelector("button[type='submit']");
      submit.disabled = true; setNotice(notice, "正在重置密码…");
      try {
        const result = await api("/api/auth/reset-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: resetToken, newPassword: password }),
        });
        setNotice(notice, result.message, "success");
        submit.hidden = true; document.getElementById("reset-back").hidden = false;
      } catch (error) { setNotice(notice, error.message, "error"); submit.disabled = false; }
    });
