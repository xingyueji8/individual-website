/* Playback policy depends on the device, not only on network buffering. */
(() => {
  function constrainedDevice() {
    return /Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent || "")
      || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)
      || Number(navigator.deviceMemory || 8) <= 4;
  }
  function qualityLimit() {
    if (navigator.connection?.saveData || /(^|-)2g|3g/.test(navigator.connection?.effectiveType || "")) return 480;
    return constrainedDevice() ? 720 : 1080;
  }
  function videoVariants(variants = []) {
    return variants.filter(item => (!item.status || item.status === "ready") && /^(360|480|720|1080)p$/.test(item.label))
      .sort((a, b) => parseInt(a.label) - parseInt(b.label));
  }
  function preferredVariant(variants) {
    const available = videoVariants(variants);
    return available.filter(item => parseInt(item.label) <= qualityLimit()).at(-1) || available[0] || null;
  }
  function hlsConfig() {
    const constrained = constrainedDevice();
    return { enableWorker: true, startLevel: -1, capLevelToPlayerSize: true,
      capLevelOnFPSDrop: true, maxDevicePixelRatio: constrained ? 1 : 2,
      maxBufferLength: constrained ? 15 : 30, maxMaxBufferLength: constrained ? 30 : 120,
      backBufferLength: constrained ? 10 : 30, maxBufferSize: (constrained ? 20 : 60) * 1000 * 1000 };
  }
  function capHlsLevels(player) {
    const cap = qualityLimit();
    const levels = player.levels || [];
    let selected = -1, height = -1;
    levels.forEach((level, index) => { if (Number(level.height) > height && level.height <= cap) { selected = index; height = Number(level.height); } });
    if (selected < 0 && levels.length) selected = levels.reduce((best, level, index) => Number(level.height) < Number(levels[best].height) ? index : best, 0);
    player.autoLevelCapping = selected;
  }
  function disposeMedia(media) {
    managed.get(media)?.dispose();
    try { media.pause(); } catch { /* Uninitialized or removed media. */ }
    media.removeAttribute("src");
    media.querySelectorAll?.("source").forEach(source => source.removeAttribute("src"));
    try { media.load(); } catch { /* Some embedded preview environments do not implement load. */ }
  }
  function watchPlaybackHealth(video, onProblem) {
    let timer = null, previous = null, lastTime = Number(video.currentTime) || 0, advancedAt = Date.now(), waitingAt = 0, finished = false;
    const reset = () => { previous = null; waitingAt = 0; lastTime = Number(video.currentTime) || 0; advancedAt = Date.now(); };
    const stop = () => { if (timer !== null) clearInterval(timer); timer = null; reset(); };
    const report = reason => { if (finished) return; finished = true; stop(); Promise.resolve(onProblem({ reason })).catch(() => {}); };
    const sample = () => {
      if (document.hidden || video.paused || video.seeking || video.ended || video.playbackRate === 0) { reset(); return; }
      const now = Date.now(), position = Number(video.currentTime) || 0;
      if (position > lastTime + .1 || position < lastTime - .1) { lastTime = position; advancedAt = now; }
      if ((waitingAt || video.readyState < 3) && now - advancedAt >= 8000) { report("buffering"); return; }
      if (video.readyState >= 3 && now - advancedAt >= 10000) { report("decoding"); return; }
      if (video.readyState < 3) { previous = null; return; }
      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) return;
      const next = { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
      if (previous) {
        const frames = next.total - previous.total;
        if (frames >= 30 && (next.dropped - previous.dropped) / frames > .15) {
          report("decoding"); return;
        }
      }
      previous = next;
    };
    const start = () => { if (!finished && timer === null) { reset(); timer = setInterval(sample, 1500); } };
    const playing = () => { reset(); start(); };
    const waiting = () => { start(); waitingAt ||= Date.now(); };
    video.addEventListener("play", start); video.addEventListener("playing", playing); video.addEventListener("pause", stop);
    video.addEventListener("waiting", waiting); video.addEventListener("stalled", waiting);
    video.addEventListener("ended", stop); video.addEventListener("seeking", reset); video.addEventListener("seeked", reset);
    // Re-arming after an HLS downgrade must also monitor an already-playing video.
    if (!video.paused && video.readyState >= 2) start();
    return () => {
      finished = true; stop(); video.removeEventListener("play", start); video.removeEventListener("playing", playing); video.removeEventListener("pause", stop);
      video.removeEventListener("waiting", waiting); video.removeEventListener("stalled", waiting);
      video.removeEventListener("ended", stop); video.removeEventListener("seeking", reset); video.removeEventListener("seeked", reset);
    };
  }
  function watchFrameDrops(video, onDrop) { return watchPlaybackHealth(video, onDrop); }
  const managed = new Map();
  let playEpoch = 0;
  function updateVideoRendering() {
    const active = [...managed.keys()].some(video => !video.paused && !video.ended);
    document.body?.classList.toggle("video-preview-active", active);
  }
  function attachPlayer(video, { originalUrl, variants = [], streamUrl = "", preload = "none", setSource, lowerStream, onStatus = () => {}, onSourceChange = () => {} } = {}) {
    managed.get(video)?.dispose();
    const versions = videoVariants(variants).filter(item => item.url);
    const original = { url: originalUrl, label: "原始文件", height: Infinity, hls: false };
    const prepared = versions.map(item => ({ ...item, height: parseInt(item.label), hls: false }));
    const best = prepared.find(item => item.url === preferredVariant(versions)?.url) || (originalUrl ? original : prepared[0]);
    const automaticSource = streamUrl ? { url: streamUrl, label: "自动画质", height: Infinity, hls: true } : best;
    let current = null, automatic = true, disposed = false, generation = 0, stopHealth = null, restore = null, pendingPosition = null, switching = false, wantsPlayback = false, intentEpoch = 0;
    const failed = new Set();
    video.preload = preload; video.playsInline = true;
    const notify = () => { if (current) onSourceChange({ ...current, automatic }); };
    const arm = () => { stopHealth?.(); stopHealth = watchPlaybackHealth(video, issue => downgrade(issue.reason)); };
    const load = setSource || ((source, options) => { if (options.hls) throw new Error("此处暂不支持自动流"); video.src = source; video.load(); });
    async function change(next, { auto = automatic } = {}) {
      if (disposed || !next?.url) return;
      const modeChanged = automatic !== auto;
      automatic = auto;
      if (current?.url === next.url && current.hls === next.hls) { notify(); if (modeChanged) arm(); return; }
      // A second selection can arrive while load() has reset currentTime to zero.
      const sequence = ++generation, position = pendingPosition ?? (Number(video.currentTime) || 0), resume = wantsPlayback || !video.paused, restoreIntent = intentEpoch;
      pendingPosition = position;
      stopHealth?.(); stopHealth = null;
      if (restore) video.removeEventListener("loadedmetadata", restore);
      restore = () => {
        if (disposed || sequence !== generation) return;
        restore = null; pendingPosition = null;
        if (position > 0 && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(position, Math.max(0, video.duration - .05));
        if (resume && restoreIntent === intentEpoch && restoreIntent === playEpoch) { wantsPlayback = true; Promise.resolve(video.play()).catch(() => onStatus("请点击播放继续观看。")); }
      };
      video.addEventListener("loadedmetadata", restore, { once: true });
      current = next; switching = true; notify();
      try { await load(next.url, { hls: next.hls }); }
      catch { if (!disposed && sequence === generation) { failed.add(next.url); await downgrade("source-error"); } }
      finally { if (!disposed && sequence === generation) { switching = false; arm(); updateVideoRendering(); } }
    }
    async function downgrade(reason) {
      if (disposed || !current) return;
      // Manual quality is a fixed choice; health monitoring may suggest a change.
      if (!automatic) {
        const alternatives = prepared.length || streamUrl;
        onStatus(reason === "source-error"
          ? `所选画质无法播放，${alternatives ? "可选择其他清晰度或“自动流畅”。" : "请稍后重试或联系站长。"}`
          : `检测到${reason === "buffering" ? "持续缓冲" : "播放掉帧"}，已保留您选择的${current.label}。${alternatives ? "可切换为“自动流畅”或较低清晰度。" : "当前尚无较低清晰度预览版本。"}`);
        return;
      }
      if (reason !== "source-error" && current.hls && lowerStream?.()) {
        onStatus("已降低自动画质，优先保证流畅播放。"); arm(); return;
      }
      if (reason === "source-error") failed.add(current.url);
      const lower = current.hls ? (prepared.length ? best : null) : prepared.filter(item => item.height < current.height && !failed.has(item.url)).at(-1);
      const candidate = lower && !failed.has(lower.url) ? lower : reason === "source-error" ? [...prepared].reverse().find(item => !failed.has(item.url)) || (originalUrl && !failed.has(originalUrl) ? original : null) : null;
      if (!candidate || candidate.url === current.url) {
        onStatus(reason === "source-error" ? "当前视频版本无法播放，请尝试其他清晰度或联系站长。" : "当前视频没有更低清晰度的预览版本，无法继续降低画质。"); return;
      }
      onStatus(`${reason === "buffering" ? "检测到持续缓冲" : reason === "decoding" ? "检测到播放掉帧" : "当前视频版本播放失败"}，正在切换为 ${candidate.label}。`);
      await change(candidate, { auto: true });
    }
    const play = () => { wantsPlayback = true; intentEpoch = ++playEpoch; video.preload = "auto"; for (const other of managed.keys()) if (other !== video && !other.paused) { try { other.pause(); other.preload = "metadata"; } catch {} } updateVideoRendering(); };
    const pause = () => { if (!switching) wantsPlayback = false; updateVideoRendering(); };
    const error = () => { if (!switching) downgrade("source-error").catch(() => {}); };
    const controller = {
      select(url, options = {}) { failed.clear(); return change(prepared.find(item => item.url === url) || { url, label: options.label || (options.hls ? "自动画质" : "原始文件"), height: Infinity, hls: Boolean(options.hls) }, { auto: false }); },
      auto() { failed.clear(); return change(automaticSource, { auto: true }); },
      get current() { return current; },
      dispose() {
        if (disposed) return; disposed = true; generation += 1; stopHealth?.();
        if (restore) video.removeEventListener("loadedmetadata", restore);
        video.removeEventListener("play", play); video.removeEventListener("pause", pause); video.removeEventListener("ended", pause);
        video.removeEventListener("error", error); video.removeEventListener("xyj-video-source-error", error);
        managed.delete(video); updateVideoRendering();
      },
    };
    managed.set(video, controller);
    video.addEventListener("play", play); video.addEventListener("pause", pause); video.addEventListener("ended", pause);
    video.addEventListener("error", error); video.addEventListener("xyj-video-source-error", error);
    controller.ready = change(automaticSource, { auto: true }); return controller;
  }
  function previewControls(video, { originalUrl, variants = [] } = {}) {
    const controls = document.createElement("div"); controls.className = "video-quality-controls";
    const label = document.createElement("label"), select = document.createElement("select"); select.setAttribute("aria-label", "视频播放画质");
    const name = document.createElement("span"); name.textContent = "播放画质"; label.append(name, select);
    for (const source of [{ url: "", label: "自动流畅" }, ...videoVariants(variants), { url: originalUrl, label: "原始文件" }]) {
      const option = document.createElement("option"); option.value = source.url; option.textContent = source.label; select.append(option);
    }
    const status = document.createElement("p"); status.className = "video-playback-status"; status.setAttribute("role", "status");
    controls.append(label, status); label.hidden = !videoVariants(variants).length;
    const controller = attachPlayer(video, { originalUrl, variants,
      onStatus(message) { status.textContent = message; },
      onSourceChange(source) { select.value = source.automatic ? "" : source.url; status.textContent = source.label === "原始文件" && !videoVariants(variants).length ? "当前只有原始文件，暂无较低清晰度预览版本。" : `当前画质：${source.label}${source.automatic ? "（流畅优先）" : ""}`; },
    });
    select.addEventListener("change", () => { if (select.value) controller.select(select.value); else controller.auto(); });
    return controls;
  }
  globalThis.XYJVideo = { constrainedDevice, preferredVariant, videoVariants, hlsConfig, capHlsLevels, disposeMedia, watchFrameDrops, watchPlaybackHealth, attachPlayer, previewControls };
})();
