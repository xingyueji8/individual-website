    /* ---------- 06. 文件目录、文档阅读和视频清晰度。 ---------- */
    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024) return `${bytes} B`;
      const units = ["KiB", "MiB", "GiB", "TiB"];
      let size = bytes; let unit = -1;
      do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
      return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
    }

    function resourceFolderPath(id) {
      if (!id) return "根目录";
      const folders = new Map((state.data?.assetFolders || []).map((item) => [item.id, item]));
      const names = []; const visited = new Set(); let cursor = folders.get(id);
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id); names.unshift(cursor.name);
        cursor = cursor.parent_id ? folders.get(cursor.parent_id) : null;
      }
      return names.join(" / ") || "根目录";
    }

    function resourceIcon(kind) {
      return ({ video: "🎬", audio: "🎵", pdf: "📕", word: "📘", archive: "🗜️", file: "📦" })[kind] || "📦";
    }

    function resourceCardForFolder(folder) {
      const card = document.createElement("article"); card.className = "resource-card"; card.tabIndex = 0; card.setAttribute("role", "button");
      const icon = document.createElement("div"); icon.className = "resource-card-icon"; icon.textContent = "📁";
      const title = document.createElement("h3"); title.textContent = folder.name;
      const description = document.createElement("p"); description.textContent = folder.description || "打开文件夹查看内容";
      const badges = document.createElement("div"); badges.className = "resource-badges";
      const type = document.createElement("span"); type.className = "resource-badge"; type.textContent = "文件夹"; badges.append(type);
      if (folder.archive_asset_id && (state.data?.assets || []).some((asset) => asset.id === folder.archive_asset_id)) { const zip = document.createElement("span"); zip.className = "resource-badge"; zip.textContent = "支持整包下载"; badges.append(zip); }
      card.append(icon, title, description, badges);
      const open = async () => {
        if (!(await ensureContentUnlocked("assetFolder", folder))) return;
        state.currentResourceFolder = folder.id;
        const reader = document.getElementById("reader-dialog"); if (reader.open) reader.close();
        state.activePortfolioSection = folder.section_id || "section-resources";
        activePortfolioCategory = "resources";
        personalSpaceRoute = { category: "resources", sectionId: state.activePortfolioSection, subsectionId: "", all: true };
        if (state.activeSection !== "portfolio") navigateSection("portfolio", { preservePortfolio: true });
        personalSpaceNavigate(personalSpaceRoute, { preserveFolder: true });
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      return card;
    }

    function resourceCardForAsset(asset) {
      const card = document.createElement("article"); card.className = "resource-card"; card.tabIndex = 0; card.setAttribute("role", "button");
      const icon = document.createElement("div"); icon.className = "resource-card-icon"; icon.textContent = resourceIcon(asset.kind);
      const title = document.createElement("h3"); title.textContent = asset.display_name;
      const description = document.createElement("p"); description.textContent = `${asset.note ? `${asset.note} · ` : ""}${asset.kind.toUpperCase()} · ${formatBytes(asset.size_bytes)}`;
      const badges = document.createElement("div"); badges.className = "resource-badges";
      const view = document.createElement("span"); view.className = "resource-badge"; view.textContent = asset.kind === "archive" ? "直接下载" : "在线预览"; badges.append(view);
      if ((asset.variants || []).length) { const versions = document.createElement("span"); versions.className = "resource-badge"; versions.textContent = `${asset.variants.length} 个版本`; badges.append(versions); }
      if (!asset.canDownload) { const lock = document.createElement("span"); lock.className = "resource-badge"; lock.textContent = "登录后下载"; badges.append(lock); }
      card.append(icon, title, description, badges);
      const open = async () => {
        if (!(await ensureContentUnlocked("asset", asset))) return;
        if (asset.kind === "archive") {
          if (!asset.downloadUrl) { showAuthLock("download"); return; }
          location.href = protectedMediaUrl(asset.downloadUrl); return;
        }
        openResourceAsset(asset);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      return card;
    }

    function renderResources(requestedSubsection = null) { renderOrganizedResources(requestedSubsection); }

    function resourceDownloadButton(label, url) {
      if (!url) {
        const button = document.createElement("button"); button.type = "button"; button.className = "btn small ghost"; button.textContent = `${label}（登录后可用）`;
        button.addEventListener("click", () => showAuthLock("download")); return button;
      }
      const link = document.createElement("a"); link.className = "btn small ghost"; link.href = url; link.textContent = label; link.setAttribute("download", ""); return link;
    }

    function loadHlsLibrary() {
      if (window.Hls) return Promise.resolve(window.Hls);
      if (!state.hlsLibraryPromise) {
        state.hlsLibraryPromise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js";
          script.referrerPolicy = "no-referrer";
          const timer=setTimeout(()=>{script.remove();reject(new Error("HLS 组件加载超时"))},8000);
          script.onload = () => {clearTimeout(timer);window.Hls ? resolve(window.Hls) : reject(new Error("HLS 组件加载失败"))};
          script.onerror = () => {clearTimeout(timer);reject(new Error("HLS 组件加载失败"))};
          document.head.append(script);
        }).catch((error) => { state.hlsLibraryPromise = null; throw error; });
      }
      return state.hlsLibraryPromise;
    }

    async function setResourceVideoSource(video, source, { hls = false } = {}) {
      const generation = state.resourceSourceGeneration = (state.resourceSourceGeneration || 0) + 1;
      state.hlsSourceCancel?.();state.hlsSourceCancel=null;
      state.hlsPlayer?.destroy?.(); state.hlsPlayer = null;
      if (!hls || video.canPlayType("application/vnd.apple.mpegurl")) { video.src = source; video.load(); return; }
      const Hls = await loadHlsLibrary();
      if (generation !== state.resourceSourceGeneration || state.activeResourceVideo !== video || !video.isConnected) return;
      if (!Hls.isSupported()) throw new Error("当前浏览器不支持 HLS 自动画质");
      const player = new Hls(globalThis.XYJVideo.hlsConfig()); state.hlsPlayer = player;
      await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);state.hlsSourceCancel=null;callback(value)};
        const timer=setTimeout(()=>finish(reject,new Error("自动流读取超时")),12000);
        state.hlsSourceCancel=()=>finish(resolve);
        player.on(Hls.Events.MANIFEST_PARSED,()=>{globalThis.XYJVideo.capHlsLevels(player);finish(resolve)});
        player.on(Hls.Events.ERROR,(_event,data)=>{
          if(!data.fatal||generation!==state.resourceSourceGeneration)return;
          if(!settled)finish(reject,new Error("自动流暂时无法播放"));
          else video.dispatchEvent(new Event("xyj-video-source-error"));
        });
        player.loadSource(source);player.attachMedia(video);
      });
    }

    function videoSourceButton(video, source, label, host, options = {}) {
      const control=document.createElement("button");control.type="button";control.className="btn small ghost";control.textContent=label;control.dataset.videoSource=source;
      control.addEventListener("click",()=>state.videoPlaybackController?.select(source,{...options,label}));
      return control;
    }

    const RESOURCE_VIDEO_SEEK_SECONDS = 5;
    const RESOURCE_VIDEO_VOLUME_STEP = .05;

    /*
     * 浏览器原生视频控件只有在恰好取得焦点时才可能响应方向键，而且不同
     * 浏览器的行为并不一致。资源弹窗因此统一接管方向键：左右跳转时间，
     * 上下调节音量；输入控件与带修饰键的快捷键不受影响。
     */
    function handleResourceVideoKeyboard(event) {
      const video = state.activeResourceVideo;
      const dialog = document.getElementById("resource-dialog");
      if (!dialog.open || !video?.isConnected || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element
        && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : Number.POSITIVE_INFINITY;
      let handled = true;

      if (event.key === "ArrowLeft") {
        video.currentTime = Math.max(0, currentTime - RESOURCE_VIDEO_SEEK_SECONDS);
      } else if (event.key === "ArrowRight") {
        video.currentTime = Math.min(duration, currentTime + RESOURCE_VIDEO_SEEK_SECONDS);
      } else if (event.key === "ArrowUp") {
        video.muted = false;
        video.volume = Math.min(1, Math.round((video.volume + RESOURCE_VIDEO_VOLUME_STEP) * 100) / 100);
      } else if (event.key === "ArrowDown") {
        video.volume = Math.max(0, Math.round((video.volume - RESOURCE_VIDEO_VOLUME_STEP) * 100) / 100);
        video.muted = video.volume === 0;
      } else {
        handled = false;
      }

      if (!handled) return;
      event.preventDefault();
    }

    async function openResourceAsset(asset) {
      if (!(await ensureContentUnlocked("asset", asset))) return;
      stopResourcePlayback();
      asset = { ...asset, url:protectedMediaUrl(asset.url), downloadUrl:protectedMediaUrl(asset.downloadUrl), poster_url:protectedMediaUrl(asset.poster_url), variants:(asset.variants||[]).map(item=>({...item,url:protectedMediaUrl(item.url),downloadUrl:protectedMediaUrl(item.downloadUrl)})) };
      state.activeResourceAsset = asset;
      state.activeResourceVideo = null;
      const dialog = document.getElementById("resource-dialog");
      const viewer = document.getElementById("resource-viewer");
      const quality = document.getElementById("resource-quality-options");
      const downloads = document.getElementById("resource-download-options");
      viewer.replaceChildren(); quality.replaceChildren(); downloads.replaceChildren();
      document.getElementById("resource-video-status").hidden = true;
      document.getElementById("resource-title").textContent = asset.display_name;
      document.getElementById("resource-meta").textContent = `${asset.kind.toUpperCase()} · ${formatBytes(asset.size_bytes)} · ${resourceFolderPath(asset.folder_id)}`;

      const variants = (asset.variants || []).filter((item) => item.status === "ready");
      if (asset.kind === "video") {
        const video = document.createElement("video"); video.controls = true; video.playsInline = true; video.preload = "metadata";
        video.setAttribute("controlsList", "nodownload noremoteplayback"); video.disablePictureInPicture = true;
        video.tabIndex = 0;
        video.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");
        video.setAttribute("aria-label", `播放视频：${asset.display_name}`);
        video.title = "键盘：←/→ 快退/快进 5 秒，↑/↓ 调节音量";
        state.activeResourceVideo = video;
        document.body.classList.add("video-preview-active");
        if (asset.poster_url) video.poster = asset.poster_url;
        const videoVariants=globalThis.XYJVideo.videoVariants(variants);
        const automatic=document.createElement("button");automatic.type="button";automatic.className="btn small ghost";automatic.textContent="自动流畅";automatic.dataset.videoAuto="true";automatic.hidden=!videoVariants.length&&!asset.stream_hls_url;
        automatic.addEventListener("click",()=>state.videoPlaybackController?.auto());quality.append(automatic);
        quality.append(videoSourceButton(video,asset.url,"原始文件",quality));
        videoVariants.forEach(variant=>quality.append(videoSourceButton(video,variant.url,variant.label,quality)));
        viewer.append(video);
        state.videoPlaybackController=globalThis.XYJVideo.attachPlayer(video,{
          originalUrl:asset.url,variants:videoVariants,streamUrl:asset.stream_hls_url,preload:"metadata",
          setSource:(source,options)=>setResourceVideoSource(video,source,options),
          lowerStream:()=>{const hls=state.hlsPlayer;if(!hls||!Number.isInteger(hls.currentLevel)||hls.currentLevel<=0)return false;const level=hls.currentLevel-1;hls.autoLevelCapping=level;hls.nextLevel=level;return true},
          onStatus:message=>{if(state.activeResourceVideo!==video)return;const status=document.getElementById("resource-video-status");status.hidden=false;status.textContent=message},
          onSourceChange:source=>{quality.querySelectorAll("button").forEach(control=>control.classList.toggle("active",source.automatic&&!automatic.hidden?control.dataset.videoAuto==="true":control.dataset.videoSource===source.url));const status=document.getElementById("resource-video-status");status.hidden=false;status.textContent=source.label==="原始文件"&&!videoVariants.length&&!asset.stream_hls_url?"当前只有原始文件，暂无较低清晰度预览版本。":`当前画质：${source.label}${source.automatic?"（流畅优先）":""}`},
        });
        downloads.append(resourceDownloadButton("下载原始视频",asset.downloadUrl));
        videoVariants.forEach(variant=>downloads.append(resourceDownloadButton(`下载 ${variant.label}`,variant.downloadUrl)));
      } else if (asset.kind === "audio") {
        const audio = document.createElement("audio"); audio.controls = true; audio.preload = "metadata"; audio.src = asset.url; audio.style.width = "min(680px,90%)"; viewer.append(audio);
        downloads.append(resourceDownloadButton("下载音频", asset.downloadUrl));
      } else if (asset.kind === "pdf") {
        const frame = document.createElement("iframe"); frame.src = asset.url; frame.title = asset.display_name; viewer.append(frame);
        downloads.append(resourceDownloadButton("下载 PDF 原件", asset.downloadUrl));
      } else if (asset.kind === "word") {
        const preview = variants.find((item) => item.label === "preview");
        if (preview || asset.canDownload) {
          const frame = document.createElement("iframe"); frame.title = asset.display_name;
          frame.src = preview?.url || `/document-viewer.html?asset=${encodeURIComponent(asset.id)}${contentGrantTokens() ? `&grants=${encodeURIComponent(contentGrantTokens())}` : ""}`; viewer.append(frame);
        } else {
          const message = document.createElement("div"); message.className = "resource-viewer-message";
          message.textContent = "此文档未开放原件下载，站长上传 PDF 预览版后即可在线阅读。"; viewer.append(message);
        }
        downloads.append(resourceDownloadButton("下载 Word 原件", asset.downloadUrl));
        if (preview) downloads.append(resourceDownloadButton("下载 PDF 预览", preview.downloadUrl));
      } else {
        const message = document.createElement("div"); message.className = "resource-viewer-message";
        message.textContent = "浏览器不能直接预览这种文件格式，你可以使用下方下载按钮保存原件。"; viewer.append(message);
        downloads.append(resourceDownloadButton("下载原文件", asset.downloadUrl));
      }
      if (!dialog.open) dialog.showModal();
      if (state.activeResourceVideo) {
        requestAnimationFrame(() => state.activeResourceVideo?.focus({ preventScroll: true }));
      }
    }
