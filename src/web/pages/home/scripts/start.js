    /* 命中过运行时拦截的同一标签页刷新后仍保持关闭状态，不能靠刷新绕过。 */
    if (sessionStorage.getItem("xyj_runtime_blocked") === "1") {
      handleRuntimeBotDetected("本标签页此前因异常自动化行为被终止，请将其关闭后重新访问。");
    } else {
      // Prepare verification in parallel with session detection, never after it.
      if (!androidLoginRequested) {
        initializeGuestProtection().catch(() => {});
        initializeEntryPhotoBackground();
      }
      boot();
    }
