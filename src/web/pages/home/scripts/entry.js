    /*
     * bootstrap 只读取通过登录或游客验证后可以看到的网站主体数据；入口背景
     * 使用更小的 /api/guest/entry-background，避免验证前暴露文章和相册清单。
     * 登录身份发生改变时传入 fresh=true，重新取得该身份可以看到的内容。
     */
    function loadBootstrap({ fresh = false } = {}) {
      if (fresh) state.bootstrapPromise = null;
      if (!state.bootstrapPromise) {
        state.bootstrapPromise = api("/api/bootstrap").catch((error) => {
          state.bootstrapPromise = null;
          throw error;
        });
      }
      return state.bootstrapPromise;
    }

    /* 背景接口已经在服务端筛掉非公开照片，这里只去重并提取预览地址。 */
    function entryPhotoUrls(data) {
      return [...new Set((data?.photos || []).map((photo) => photo.url).filter(Boolean))];
    }

    /*
     * Turnstile 使用显式渲染：只有 Worker 返回已配置时才加载 Cloudflare 脚本。
     * 前端 callback 取得的 Token 不能单独视为通过，游客入口还会把它提交给
     * /api/guest/enter，由 Worker 调用 Siteverify 进行不可绕过的服务端校验。
     */
    function initializeGuestProtection() {
      return entryChallenge.initialize();
    }

    function resetGuestTurnstile() {
      entryChallenge.reset();
    }

    /*
     * 只创建两个 frame 并轮换，避免一次性加载全部公开照片。电脑和手机都由
     * complete 清晰公开原图 cover 铺满；登录卡片的 lens 复用同一地址，浏览器
     * 会直接命中缓存。接口只允许公开图片作为背景，不会泄露受保护的 R2 原片。
     */
    function startEntryPhotoBackground(urls) {
      const host = document.getElementById("entry-photo-background");
      if (!host || !urls.length || state.entryBackgroundStarted) return;
      state.entryBackgroundStarted = true;

      const createFrame = () => {
        const root = document.createElement("div");
        root.className = "entry-photo-frame";
        const complete = document.createElement("img");
        complete.className = "photo-complete";
        complete.alt = "";
        complete.decoding = "async";
        root.append(complete); host.append(root);
        return { root, complete };
      };
      const frames = [createFrame(), createFrame()];
      const glassLens = globalThis.XingyuejiLiquidGlass?.createPhotoLens([
        document.querySelector(".entry-card"),
      ]);
      const setFrameSource = (frame, url, ready) => {
        const absoluteUrl = new URL(url, location.href).href;
        if (frame.complete.src === absoluteUrl && frame.complete.complete) {
          queueMicrotask(ready);
          return;
        }
        frame.complete.onload = ready;
        frame.complete.src = url;
      };
      let activeFrame = 0;
      let photoIndex = 0;
      const effects = ["effect-fade", "effect-wipe-left", "effect-wipe-right", "effect-reveal-center"];
      let effectIndex = 0;
      frames[0].root.classList.add(effects[effectIndex]);
      setFrameSource(frames[0], urls[0], () => {
        frames[0].root.classList.add("active");
        glassLens?.setSource(urls[0]);
      });

      if (urls.length === 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      window.setInterval(() => {
        const nextFrame = activeFrame === 0 ? 1 : 0;
        photoIndex = (photoIndex + 1) % urls.length;
        const incoming = frames[nextFrame];
        const outgoing = frames[activeFrame];
        setFrameSource(incoming, urls[photoIndex], () => {
          effectIndex = (effectIndex + 1) % effects.length;
          incoming.root.classList.remove("active", ...effects);
          incoming.root.classList.add(effects[effectIndex], "active");
          outgoing.root.classList.remove("active");
          glassLens?.setSource(urls[photoIndex]);
          activeFrame = nextFrame;
        });
      }, 7_000);
    }

    async function initializeEntryPhotoBackground() {
      try { startEntryPhotoBackground(entryPhotoUrls(await api("/api/guest/entry-background"))); }
      catch { /* 没有照片或数据服务暂时失败时继续使用 CSS 渐变背景。 */ }
    }

    const accountStatusLabels = {
      pending: "等待审核", approved: "已通过审核",
      rejected: "审核未通过", disabled: "账号已停用",
    };

    function hasFullAccess() {
      return state.auth.authenticated && state.auth.user?.status === "approved";
    }

    /*
     * 下载权限同时控制三个入口：文章顶部 PDF、文章底部 PDF、图片原片。
     * 入口跟随服务端计算的逐项下载权限；图片还必须确实存在原片下载地址。
     * 后端会再次验证身份，因此手工取消 hidden 也不能绕过权限。
     */
    function syncProtectedDownloadControls() {
      const fullAccess = Boolean(state.currentContent?.canDownload);
      document.querySelectorAll("#reader-print, #content-pdf").forEach((button) => {
        button.hidden = !fullAccess;
      });

      const download = document.getElementById("image-download");
      const currentPhoto = state.imageSequence[state.currentImageIndex];
      const downloadUrl = String(currentPhoto?.downloadUrl || "");
      const canDownloadOriginal = Boolean(currentPhoto?.canDownload) && Boolean(downloadUrl);
      download.hidden = !canDownloadOriginal;
      if (canDownloadOriginal) download.href = protectedMediaUrl(downloadUrl);
      else download.removeAttribute("href");
    }

    /*
     * 受限功能统一使用同一个登录提示框。游客看到登录/注册快捷入口；
     * 已登录但未通过审核的用户会看到自己的具体审核状态。
     */
    function showAuthLock(feature = "full") {
      const dialog = document.getElementById("auth-lock-dialog");
      const title = document.getElementById("auth-lock-title");
      const message = document.getElementById("auth-lock-message");
      const loginLink = document.getElementById("auth-login-link");
      const registerLink = document.getElementById("auth-register-link");
      const nextTarget = feature === "ai" ? "/#ai-helper" : (feature === "download" ? "/#portfolio" : "/#account");
      const next = encodeURIComponent(nextTarget);
      const nextHash = new URL(nextTarget, location.origin).hash;

      if (!state.auth.authenticated) {
        title.textContent = "请登录以使用完整功能";
        message.textContent = feature === "ai"
          ? "AI 助手仅向审核通过的账号开放。你可以立即登录或提交注册申请。"
          : (feature === "download"
            ? "文章 PDF 与图片原片仅向审核通过的账号开放；游客仍可阅读文章和查看图片预览。"
            : "登录后可以查看账户状态、修改昵称和密码。");
        /*
         * login=1 会让同一域名下的链接发生一次真正的页面重载，而不是只触发
         * hashchange；重新载入后根页面显示唯一的全屏登录框，并保留目标板块。
         */
        loginLink.textContent = "登录"; loginLink.href = `/?login=1${nextHash}`;
        registerLink.hidden = false; registerLink.href = `/login?mode=register&next=${next}`;
      } else {
        const status = state.auth.user.status;
        title.textContent = status === "pending" ? "账号正在等待审核" : "账号暂时没有完整权限";
        message.textContent = feature === "download"
          ? (status === "pending"
            ? "站长审核通过后，文章 PDF 与图片原片下载会自动开放。"
            : "当前账号暂时不能下载文章 PDF 或图片原片，请前往账户中心查看审核状态。")
          : (status === "pending"
            ? "站长审核通过后，AI 助手和个人空间完整内容会自动开放。"
            : "请前往账户中心查看审核状态；如有疑问，可以通过留言与反馈联系站长。");
        loginLink.textContent = "查看账户状态"; loginLink.href = "/#account";
        registerLink.hidden = true;
      }
      if (!dialog.open) dialog.showModal();
    }

    function empty(message) {
      const box = document.createElement("div");
      box.className = "empty";
      box.textContent = message;
      return box;
    }
