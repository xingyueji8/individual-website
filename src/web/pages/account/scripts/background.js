    /*
     * 专用入口接口已经在 Worker 端完成“大板块公开 + 照片公开”双重筛选，
     * 并且不要求游客会话。旧代码请求 /api/bootstrap，会在尚未登录/验证时
     * 得到 401，注册页因而只能显示黑色备用背景。
     */
    function publicPhotoUrls(data) {
      return [...new Set((data?.photos || []).map((photo) => photo.url).filter(Boolean))];
    }

    /*
     * 两个 frame 循环复用，避免一次加载所有公开照片。电脑和手机都使用清晰
     * cover 主图；卡片折射层复用同一压缩预览，浏览器会命中自身缓存。
     */
    function startPhotoBackground(urls) {
      const host = document.getElementById("auth-photo-background");
      if (!host || !urls.length) return;
      const createFrame = () => {
        const root = document.createElement("div");
        root.className = "auth-photo-frame";
        const complete = document.createElement("img");
        complete.className = "photo-complete";
        complete.alt = "";
        complete.decoding = "async";
        root.append(complete); host.append(root);
        return { root, complete };
      };
      const frames = [createFrame(), createFrame()];
      const glassLens = globalThis.XingyuejiLiquidGlass?.createPhotoLens([
        document.querySelector(".auth-card"),
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

    async function initializePhotoBackground() {
      try { startPhotoBackground(publicPhotoUrls(await api("/api/guest/entry-background"))); }
      catch { /* 数据服务失败时保留纯色背景，不影响登录和注册表单。 */ }
    }
