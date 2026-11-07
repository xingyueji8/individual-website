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
    let selected = -1;
    levels.forEach((level, index) => { if (Number(level.height) > 0 && level.height <= cap) selected = index; });
    if (selected < 0 && levels.length) selected = 0;
    player.autoLevelCapping = selected;
  }
  function disposeMedia(media) {
    try { media.pause(); } catch { /* Uninitialized or removed media. */ }
    media.removeAttribute("src");
    media.querySelectorAll?.("source").forEach(source => source.removeAttribute("src"));
    try { media.load(); } catch { /* Some embedded preview environments do not implement load. */ }
  }
  function watchFrameDrops(video, onDrop) {
    let timer = null, previous = null;
    const reset = () => { previous = null; };
    const stop = () => { if (timer !== null) clearInterval(timer); timer = null; reset(); };
    const sample = () => {
      if (document.hidden || video.paused || video.seeking || video.readyState < 3) { reset(); return; }
      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) return;
      const next = { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
      if (previous) {
        const frames = next.total - previous.total;
        if (frames >= 30 && (next.dropped - previous.dropped) / frames > .15) {
          stop(); Promise.resolve(onDrop()).catch(() => {}); return;
        }
      }
      previous = next;
    };
    const start = () => { stop(); timer = setInterval(sample, 3000); };
    video.addEventListener("playing", start); video.addEventListener("pause", stop);
    video.addEventListener("ended", stop); video.addEventListener("seeking", reset);
    return () => {
      stop(); video.removeEventListener("playing", start); video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop); video.removeEventListener("seeking", reset);
    };
  }
  globalThis.XYJVideo = { constrainedDevice, preferredVariant, videoVariants, hlsConfig, capHlsLevels, disposeMedia, watchFrameDrops };
})();
