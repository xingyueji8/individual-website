    const IMAGE_ZOOM_MIN = 1;
    const IMAGE_ZOOM_MAX = 5;

    function clampNumber(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    function clampImagePan() {
      const zoom = state.imageZoom;
      const stage = document.querySelector(".image-stage");
      const image = document.getElementById("image-preview");
      if (!stage || !image || zoom.scale <= IMAGE_ZOOM_MIN) {
        zoom.x = 0;
        zoom.y = 0;
        return;
      }
      const maximumX = Math.max(0, ((image.clientWidth * zoom.scale) - stage.clientWidth) / 2);
      const maximumY = Math.max(0, ((image.clientHeight * zoom.scale) - stage.clientHeight) / 2);
      zoom.x = clampNumber(zoom.x, -maximumX, maximumX);
      zoom.y = clampNumber(zoom.y, -maximumY, maximumY);
    }

    function renderImageZoom() {
      const zoom = state.imageZoom;
      const image = document.getElementById("image-preview");
      const stage = document.querySelector(".image-stage");
      clampImagePan();
      image.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
      image.classList.toggle("is-zoomed", zoom.scale > IMAGE_ZOOM_MIN + .001);
      stage.classList.toggle("is-zoomed", zoom.scale > IMAGE_ZOOM_MIN + .001);
      const percentage = `${Math.round(zoom.scale * 100)}%`;
      const output = document.getElementById("image-zoom-level");
      output.value = percentage;
      output.textContent = percentage;
      document.getElementById("image-zoom-out").disabled = zoom.scale <= IMAGE_ZOOM_MIN + .001;
      document.getElementById("image-zoom-reset").disabled = zoom.scale <= IMAGE_ZOOM_MIN + .001;
    }

    function setImageZoom(value, anchor = null) {
      const zoom = state.imageZoom;
      const previousScale = zoom.scale;
      const nextScale = clampNumber(Number(value) || IMAGE_ZOOM_MIN, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX);
      if (anchor && nextScale !== previousScale) {
        const stageRect = document.querySelector(".image-stage").getBoundingClientRect();
        const anchorX = anchor.clientX - stageRect.left - (stageRect.width / 2);
        const anchorY = anchor.clientY - stageRect.top - (stageRect.height / 2);
        const ratio = nextScale / previousScale;
        zoom.x = anchorX - ((anchorX - zoom.x) * ratio);
        zoom.y = anchorY - ((anchorY - zoom.y) * ratio);
      }
      zoom.scale = nextScale;
      if (nextScale <= IMAGE_ZOOM_MIN) {
        zoom.x = 0;
        zoom.y = 0;
      }
      renderImageZoom();
    }

    function resetImageZoom({ clearPointers = true } = {}) {
      const zoom = state.imageZoom;
      zoom.scale = IMAGE_ZOOM_MIN;
      zoom.x = 0;
      zoom.y = 0;
      zoom.dragStart = null;
      zoom.pinchStart = null;
      if (clearPointers) zoom.pointers.clear();
      renderImageZoom();
    }

    function hideImageBoundaryNotice() {
      document.getElementById("image-boundary-notice").hidden = true;
    }

    function showImageBoundaryNotice(message) {
      const notice = document.getElementById("image-boundary-notice");
      document.getElementById("image-boundary-message").textContent = message;
      notice.hidden = false;
      notice.classList.remove("is-arriving");
      void notice.offsetWidth;
      notice.classList.add("is-arriving");
    }

    function warmImagePreview(photo, priority = "high") {
      if (!photo || photo.locked || photo.locks?.length) return;
      const source = protectedMediaUrl(photo.previewUrl || photo.url || "");
      if (!source || state.preloadedImages.has(source)) return;
      const preload = new Image();
      preload.decoding = "async";
      preload.fetchPriority = priority;
      preload.onerror = () => {
        if (state.preloadedImages.get(source) === preload) state.preloadedImages.delete(source);
      };
      state.preloadedImages.set(source, preload);
      while (state.preloadedImages.size > 3) {
        const oldest = state.preloadedImages.keys().next().value;
        state.preloadedImages.get(oldest).removeAttribute("src");
        state.preloadedImages.delete(oldest);
      }
      preload.src = source;
    }

    function clearImagePreloads() {
      for (const image of state.preloadedImages.values()) image.removeAttribute("src");
      state.preloadedImages.clear();
    }

    function preloadAdjacentImages() {
      const photos = state.imageSequence;
      if (photos.length < 2 || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || "")) return;

      [-1, 1].forEach((offset) => {
        const adjacentIndex = state.currentImageIndex + offset;
        if (adjacentIndex < 0 || adjacentIndex >= photos.length) return;
        warmImagePreview(photos[adjacentIndex], "low");
      });
    }

    async function showImageAt(index) {
      const photos = state.imageSequence;
      if (!photos.length) return;
      const nextIndex = clampNumber(index, 0, photos.length - 1);
      const requestId = ++state.imageRequestId;
      state.imageTargetIndex = nextIndex;
      const photo = photos[nextIndex];
      const previous = photos[state.currentImageIndex];
      const mediaId = photo.mediaId || mediaIdFromUrl(photo.previewUrl || photo.url) || photo.id;
      const previousMediaId = previous && (previous.mediaId || mediaIdFromUrl(previous.previewUrl || previous.url) || previous.id);
      if (previousMediaId && previousMediaId !== mediaId) {
        const owner = `media:${previousMediaId}`;
        if ([...contentViewGrants.values()].some(grant => grant.owner === owner)) await releaseViewGrants(owner);
      }
      if (requestId !== state.imageRequestId) return false;
      // The image byte route checks current permissions itself. Only known
      // locks need the extra PIN/access round trip before loading the preview.
      if (mediaId && !String(mediaId).startsWith("reader-") && (photo.locked || photo.locks?.length)) {
        const target = { ...photo, id:mediaId };
        if (!(await ensureContentUnlocked("media", target))) {
          if (requestId === state.imageRequestId) state.imageTargetIndex = state.currentImageIndex;
          return false;
        }
        if (requestId !== state.imageRequestId) {
          await closeProtectedView(`media:${mediaId}`);
          return false;
        }
        Object.assign(photo,target,{id:photo.id,mediaId});
      }
      state.currentImageIndex = nextIndex;
      hideImageBoundaryNotice();
      resetImageZoom();
      // 弹窗展示压缩预览；只有“下载原片”链接会请求 download=1。
      const image = document.getElementById("image-preview");
      const status = document.getElementById("image-load-status");
      let recovered = false;
      const load = () => {
        status.textContent = "正在加载图片…";
        status.hidden = false;
        image.style.visibility = "hidden";
        image.src = protectedMediaUrl(photo.previewUrl || photo.url);
      };
      image.onload = () => {
        if (requestId !== state.imageRequestId) return;
        image.style.visibility = "";
        status.hidden = true;
        // Prepare neighbours only after the current image has loaded, so large
        // preloads cannot compete with the image the visitor is waiting for.
        preloadAdjacentImages();
      };
      image.onerror = async () => {
        if (requestId !== state.imageRequestId) return;
        status.textContent = "图片加载失败，请重新打开或稍后重试。";
        // Handle a new/expired lock since bootstrap, without a preflight on
        // every ordinary image. A second decode/network failure is not retried.
        if (recovered || !mediaId || String(mediaId).startsWith("reader-")) return;
        recovered = true;
        const target = { ...photo, id: mediaId };
        if (!(await ensureContentUnlocked("media", target))) return;
        if (requestId !== state.imageRequestId) {
          await closeProtectedView(`media:${mediaId}`);
          return;
        }
        Object.assign(photo, target, { id: photo.id, mediaId });
        syncProtectedDownloadControls();
        load();
      };
      image.alt = photo.caption || "照片预览";
      load();
      // 可以显示站长填写的说明，但绝不使用内部文件名或文件编号兜底。
      document.getElementById("image-caption").textContent = `${photo.caption || photo.filename || ""}${photo.note ? ` · ${photo.note}` : ""}`;
      const hasMultiple = photos.length > 1;
      document.getElementById("image-previous").hidden = !hasMultiple;
      document.getElementById("image-next").hidden = !hasMultiple;
      syncProtectedDownloadControls();
      return true;
    }

    function stepImage(offset) {
      if (!document.getElementById("image-dialog").open || state.imageSequence.length < 2) return;
      const nextIndex = state.imageTargetIndex + offset;
      if (nextIndex < 0) {
        showImageBoundaryNotice("已经是第一张了");
        return;
      }
      if (nextIndex >= state.imageSequence.length) {
        showImageBoundaryNotice("已经是最后一张了");
        return;
      }
      showImageAt(nextIndex);
    }

    async function openImage(photo, photos = [photo]) {
      const oldPhoto = state.imageSequence[state.currentImageIndex];
      const oldMediaId = oldPhoto && (oldPhoto.mediaId || mediaIdFromUrl(oldPhoto.previewUrl || oldPhoto.url) || oldPhoto.id);
      const nextMediaId = photo.mediaId || mediaIdFromUrl(photo.previewUrl || photo.url) || photo.id;
      if (oldMediaId && oldMediaId !== nextMediaId) closeProtectedView(`media:${oldMediaId}`);
      state.imageSequence = photos.length ? photos : [photo];
      state.currentImageIndex = -1;
      const selectedIndex = state.imageSequence.findIndex((item) => item.id === photo.id);
      if (!(await showImageAt(selectedIndex >= 0 ? selectedIndex : 0))) return;
      if (!document.getElementById("image-dialog").open) document.getElementById("image-dialog").showModal();
      requestAnimationFrame(renderImageZoom);
    }

    function imagePinchMetrics() {
      const points = [...state.imageZoom.pointers.values()].slice(0, 2);
      if (points.length < 2) return null;
      const [first, second] = points;
      return {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
      };
    }

    function startImagePointer(event) {
      if (event.target.closest?.("button, a, .image-boundary-notice")) return;
      event.preventDefault();
      const zoom = state.imageZoom;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 浏览器可自行继续派发事件。 */ }
      zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (zoom.pointers.size === 1) {
        zoom.dragStart = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          originX: zoom.x,
          originY: zoom.y,
        };
        zoom.pinchStart = null;
        return;
      }
      const metrics = imagePinchMetrics();
      if (metrics) {
        zoom.pinchStart = { ...metrics, scale: zoom.scale, x: zoom.x, y: zoom.y };
        zoom.dragStart = null;
      }
    }

    function moveImagePointer(event) {
      const zoom = state.imageZoom;
      if (!zoom.pointers.has(event.pointerId)) return;
      event.preventDefault();
      zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (zoom.pointers.size >= 2) {
        const current = imagePinchMetrics();
        const start = zoom.pinchStart;
        if (!current || !start) return;
        const nextScale = clampNumber(
          start.scale * (current.distance / start.distance),
          IMAGE_ZOOM_MIN,
          IMAGE_ZOOM_MAX,
        );
        const ratio = nextScale / start.scale;
        const stageRect = event.currentTarget.getBoundingClientRect();
        const anchorX = start.centerX - stageRect.left - (stageRect.width / 2);
        const anchorY = start.centerY - stageRect.top - (stageRect.height / 2);
        zoom.scale = nextScale;
        zoom.x = anchorX - ((anchorX - start.x) * ratio) + (current.centerX - start.centerX);
        zoom.y = anchorY - ((anchorY - start.y) * ratio) + (current.centerY - start.centerY);
        if (nextScale <= IMAGE_ZOOM_MIN) { zoom.x = 0; zoom.y = 0; }
        renderImageZoom();
        return;
      }

      if (!zoom.dragStart || zoom.scale <= IMAGE_ZOOM_MIN) return;
      zoom.x = zoom.dragStart.originX + (event.clientX - zoom.dragStart.x);
      zoom.y = zoom.dragStart.originY + (event.clientY - zoom.dragStart.y);
      renderImageZoom();
    }

    function endImagePointer(event) {
      const zoom = state.imageZoom;
      if (!zoom.pointers.has(event.pointerId)) return;
      zoom.pointers.delete(event.pointerId);
      zoom.pinchStart = null;
      if (zoom.pointers.size === 1) {
        const [pointerId, point] = zoom.pointers.entries().next().value;
        zoom.dragStart = {
          pointerId,
          x: point.x,
          y: point.y,
          originX: zoom.x,
          originY: zoom.y,
        };
      } else {
        zoom.dragStart = null;
      }
    }
