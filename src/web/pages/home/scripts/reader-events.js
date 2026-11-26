    const installAppDialog = document.getElementById("install-app-dialog");
    const installAppMessage = document.getElementById("install-app-message");
    document.getElementById("install-app-button").addEventListener("click", async () => {
      const result = await globalThis.XYJPWA?.requestInstall?.();
      if (result?.status === "accepted") return;
      if (result?.status === "installed") {
        installAppMessage.textContent = "星月集已经作为应用运行，无需重复安装。";
      } else if (result?.status === "dismissed") {
        installAppMessage.textContent = "本次安装已取消。以后仍可在“设置”中再次选择“创建桌面访问”。";
      } else {
        installAppMessage.textContent = result?.instructions
          || "请打开浏览器菜单，选择“安装应用”“创建快捷方式”或“添加到主屏幕”。";
      }
      if (!installAppDialog.open) installAppDialog.showModal();
    });
    const imageDialog = document.getElementById("image-dialog");
    const resourceDialog = document.getElementById("resource-dialog");
    function stopResourcePlayback() {
      state.videoPlaybackController?.dispose();state.videoPlaybackController=null;
      state.hlsSourceCancel?.();state.hlsSourceCancel=null;
      state.videoFrameCleanup?.(); state.videoFrameCleanup = null;
      state.resourceSourceGeneration = (state.resourceSourceGeneration || 0) + 1;
      state.hlsPlayer?.destroy?.(); state.hlsPlayer = null;
      document.getElementById("resource-viewer").querySelectorAll("video,audio").forEach(node => globalThis.XYJVideo.disposeMedia(node));
      document.body.classList.remove("video-preview-active");
      state.activeResourceVideo = null;
    }
    resourceDialog.addEventListener("keydown", handleResourceVideoKeyboard);
    resourceDialog.addEventListener("close", () => {
      state.activeResourceVideo = null;
      state.hlsPlayer?.destroy?.(); state.hlsPlayer = null;
      stopResourcePlayback();
      document.getElementById("resource-viewer").querySelectorAll("iframe").forEach(node => node.removeAttribute("src"));
    });
    document.getElementById("image-previous").addEventListener("click", () => stepImage(-1));
    document.getElementById("image-next").addEventListener("click", () => stepImage(1));
    document.getElementById("image-boundary-close").addEventListener("click", hideImageBoundaryNotice);
    document.getElementById("image-zoom-out").addEventListener("click", () => setImageZoom(state.imageZoom.scale - .5));
    document.getElementById("image-zoom-in").addEventListener("click", () => setImageZoom(state.imageZoom.scale + .5));
    document.getElementById("image-zoom-reset").addEventListener("click", () => resetImageZoom());
    const imageStage = document.querySelector(".image-stage");
    imageStage.addEventListener("pointerdown", startImagePointer);
    imageStage.addEventListener("pointermove", moveImagePointer);
    imageStage.addEventListener("pointerup", endImagePointer);
    imageStage.addEventListener("pointercancel", endImagePointer);
    imageStage.addEventListener("wheel", (event) => {
      if (!imageDialog.open) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.18 : (1 / 1.18);
      setImageZoom(state.imageZoom.scale * factor, event);
    }, { passive: false });
    imageStage.addEventListener("dblclick", (event) => {
      if (event.target.closest?.("button, a")) return;
      event.preventDefault();
      if (state.imageZoom.scale > IMAGE_ZOOM_MIN + .001) resetImageZoom();
      else setImageZoom(2.5, event);
    });
    document.getElementById("image-preview").addEventListener("load", renderImageZoom);
    document.getElementById("image-preview").addEventListener("dragstart", (event) => event.preventDefault());
    imageDialog.addEventListener("close", () => {
      state.imageRequestId += 1;
      state.imageTargetIndex = state.currentImageIndex;
      clearImagePreloads();
      const preview = document.getElementById("image-preview");
      preview.onload = preview.onerror = null;
      preview.style.visibility = "";
      document.getElementById("image-load-status").hidden = true;
      hideImageBoundaryNotice();
      resetImageZoom();
    });
    window.addEventListener("resize", () => {
      if (imageDialog.open) renderImageZoom();
    });
    document.getElementById("image-download").addEventListener("click", (event) => {
      // 即使有人手工取消 hidden，也必须满足登录审核状态并且当前图片确有原片地址。
      if (!hasFullAccess()) {
        event.preventDefault();
        showAuthLock("download");
        return;
      }
      const currentPhoto = state.imageSequence[state.currentImageIndex];
      if (!currentPhoto?.downloadUrl) event.preventDefault();
    });
    // 键盘左右方向键与屏幕按钮使用同一套切换逻辑，Esc 仍由 dialog 原生关闭。
    imageDialog.addEventListener("keydown", (event) => {
      if (event.target.closest?.(".image-zoom-controls")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); stepImage(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); stepImage(1); }
    });
    document.getElementById("content-like").addEventListener("click", (event) => state.currentContent && sendReaction("content", state.currentContent.id, 1, event.currentTarget));
    document.getElementById("content-dislike").addEventListener("click", (event) => state.currentContent && sendReaction("content", state.currentContent.id, -1, event.currentTarget));
    document.getElementById("content-pdf").addEventListener("click", (event) => downloadCurrentContentPdf(event.currentTarget));
    document.getElementById("reader-print").addEventListener("click", (event) => downloadCurrentContentPdf(event.currentTarget));

    /*
     * 阅读器中的自动网址统一在这里拦截。阻止原始链接的默认动作后先展示真实
     * 域名；只有读者点击确认框中的“继续访问”才会新开目标网站。
     */
    document.getElementById("reader-body").addEventListener("click", (event) => {
      const link = event.target.closest?.("a[data-article-url]");
      if (!link || !event.currentTarget.contains(link)) return;
      event.preventDefault();
      event.stopPropagation();
      showArticleLinkConfirmation(link.dataset.articleUrl);
    });
    const externalLinkDialog = document.getElementById("external-link-dialog");
    document.getElementById("external-link-continue").addEventListener("click", () => {
      /* 不阻止 a 标签默认动作；先关闭确认框，再由浏览器安全地打开新窗口。 */
      externalLinkDialog.close();
    });
