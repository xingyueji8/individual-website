    /*
     * 侧栏边界回弹：桌面滚轮与手机触摸都会检测“已经到顶/到底仍继续滚动”。
     * 这里只增加 5px 的视觉回弹，不 preventDefault，因此不会破坏原生滚动，
     * 也不会覆盖支持 iOS 橡皮筋的浏览器手势。
     */
    function installSidebarEdgeBounce() {
      const sidebar = document.querySelector(".sidebar");
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      if (!sidebar) return;
      let touchStartY = null;
      let edgeLocked = false;
      let topArmed = true;
      let bottomArmed = true;

      const atTop = () => sidebar.scrollTop <= 1;
      const atBottom = () => sidebar.scrollTop + sidebar.clientHeight >= sidebar.scrollHeight - 1;
      const bounce = (edge) => {
        if (edgeLocked || reducedMotion.matches) return;
        if (edge === "top" && !topArmed) return;
        if (edge === "bottom" && !bottomArmed) return;
        if (edge === "top") topArmed = false;
        if (edge === "bottom") bottomArmed = false;
        edgeLocked = true;
        const className = edge === "top" ? "sidebar-edge-bounce-top" : "sidebar-edge-bounce-bottom";
        sidebar.classList.remove("sidebar-edge-bounce-top", "sidebar-edge-bounce-bottom");
        void sidebar.offsetWidth;
        sidebar.classList.add(className);
        window.setTimeout(() => {
          sidebar.classList.remove(className);
          edgeLocked = false;
        }, 330);
      };

      sidebar.addEventListener("wheel", (event) => {
        if (event.deltaY > 0 && !atTop()) topArmed = true;
        if (event.deltaY < 0 && !atBottom()) bottomArmed = true;
        if (event.deltaY < 0 && atTop()) bounce("top");
        if (event.deltaY > 0 && atBottom()) bounce("bottom");
      }, { passive: true });
      sidebar.addEventListener("scroll", () => {
        if (!atTop()) topArmed = true;
        if (!atBottom()) bottomArmed = true;
      }, { passive: true });
      sidebar.addEventListener("touchstart", (event) => {
        touchStartY = event.touches[0]?.clientY ?? null;
      }, { passive: true });
      sidebar.addEventListener("touchmove", (event) => {
        const currentY = event.touches[0]?.clientY;
        if (!Number.isFinite(touchStartY) || !Number.isFinite(currentY)) return;
        const distance = currentY - touchStartY;
        if (distance > 12 && atTop()) { bounce("top"); touchStartY = currentY; }
        if (distance < -12 && atBottom()) { bounce("bottom"); touchStartY = currentY; }
      }, { passive: true });
      sidebar.addEventListener("touchend", () => { touchStartY = null; }, { passive: true });
      sidebar.addEventListener("touchcancel", () => { touchStartY = null; }, { passive: true });
    }
