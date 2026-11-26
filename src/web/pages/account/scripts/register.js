    /* ---------- 三步注册 ---------- */
    function updateRegisterStep(nextStep) {
      registerStep = Math.min(3, Math.max(1, nextStep));
      document.querySelectorAll("[data-register-step]").forEach((node) => {
        node.hidden = Number(node.dataset.registerStep) !== registerStep;
      });
      document.querySelectorAll("[data-step-indicator]").forEach((node) => {
        const step = Number(node.dataset.stepIndicator);
        node.classList.toggle("active", step === registerStep);
        node.classList.toggle("done", step < registerStep);
      });
      if (registerStep === 3) renderRegisterSummary();
    }

    function validateRegisterStep() {
      const ids = registerStep === 1
        ? ["register-username", "register-nickname", "register-password", "register-password-confirm"]
        : ["register-display-name"];
      for (const id of ids) {
        const input = document.getElementById(id);
        if (!input.reportValidity()) return false;
      }
      if (registerStep === 1) {
        const password = document.getElementById("register-password").value;
        if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
          alert("密码至少需要包含一个字母和一个数字。"); return false;
        }
        if (password !== document.getElementById("register-password-confirm").value) {
          alert("两次输入的密码不一致。"); return false;
        }
      }
      return true;
    }

    function renderRegisterSummary() {
      const labels = { qq: "QQ", wechat: "微信", email: "邮箱", phone: "手机号", other: "其他" };
      const values = [
        ["登录用户名", document.getElementById("register-username").value],
        ["昵称", document.getElementById("register-nickname").value],
        ["姓名或称呼", document.getElementById("register-display-name").value],
        ["联系方式", document.getElementById("register-contact").value
          ? `${labels[document.getElementById("register-contact-type").value]} · ${document.getElementById("register-contact").value}`
          : "未填写"],
        ["备注", document.getElementById("register-note").value || "未填写"],
        ["邀请码", document.getElementById("register-invite").value || "未填写"],
      ];
      const summary = document.getElementById("register-summary"); summary.replaceChildren();
      values.forEach(([label, value]) => {
        const row = document.createElement("div"); row.className = "summary-row";
        const term = document.createElement("dt"); term.textContent = label;
        const detail = document.createElement("dd"); detail.textContent = value;
        row.append(term, detail); summary.append(row);
      });
    }

    document.querySelectorAll("[data-register-next]").forEach((button) => button.addEventListener("click", () => {
      if (validateRegisterStep()) updateRegisterStep(registerStep + 1);
    }));
    document.querySelectorAll("[data-register-back]").forEach((button) => button.addEventListener("click", () => updateRegisterStep(registerStep - 1)));

    document.getElementById("register-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = document.getElementById("register-submit");
      const notice = document.getElementById("register-notice");
      submit.disabled = true; setNotice(notice, "正在提交注册申请…");
      try {
        await api("/api/auth/register", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: document.getElementById("register-username").value,
            nickname: document.getElementById("register-nickname").value,
            password: document.getElementById("register-password").value,
            displayName: document.getElementById("register-display-name").value,
            contactType: document.getElementById("register-contact-type").value,
            contact: document.getElementById("register-contact").value,
            note: document.getElementById("register-note").value,
            inviteCode: document.getElementById("register-invite").value,
          }),
        });
        localStorage.removeItem("xyj_entry_mode");
        document.getElementById("panel-register").innerHTML = `
          <header class="card-head"><p class="eyebrow">APPLICATION SENT</p><h2>申请已提交</h2></header>
          <div class="success-box"><strong>账号目前处于待审核状态。</strong><p>QQ机器人已经尝试通知站长。审核期间你仍然可以浏览公开内容；审核通过后即可使用AI助手并查看个人空间完整内容。</p></div>
          <a class="btn block" style="margin-top:20px" href="/">进入网站</a>`;
      } catch (error) {
        setNotice(notice, error.message, "error");
      } finally { submit.disabled = false; }
    });
