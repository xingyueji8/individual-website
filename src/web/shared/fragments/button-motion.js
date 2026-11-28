    /* 小范围白光跟随真正的按钮，松手即移除。 */
    function emitHarmonyLightBloom(control, point = null) {
      if (!control.matches("button") || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
      const rect = control.getBoundingClientRect();
      const hasPointerPoint = Number.isFinite(point?.x) && Number.isFinite(point?.y);
      const x = hasPointerPoint ? point.x : rect.left + rect.width / 2;
      const y = hasPointerPoint ? point.y : rect.top + rect.height / 2;
      const bloomSize = Math.min(118, Math.max(48, Math.max(rect.width, rect.height) * .82));
      const bloom = document.createElement("span");
      bloom.className = "harmony-light-bloom";
      bloom.style.left = `${x}px`;
      bloom.style.top = `${y}px`;
      bloom.style.setProperty("--bloom-size", `${bloomSize}px`);
      bloom.setAttribute("aria-hidden", "true");
      document.body.append(bloom);
      return bloom;
    }

    /*
     * 全站晶体玻璃按钮动效：按下时压缩，松手后只回弹一次。
     * 事件委托同时覆盖以后由 JavaScript 新建的专栏、相册、评论和图片卡片。
     */
    function installLiquidGlassControlMotion({
      selector,
      ignore = ":disabled",
      ignoreId = "",
      durationFromStyle = false,
    }) {
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      let pressedControl = null;
      let pressedBloom = null;
      const reboundTimers = new WeakMap();

      const findControl = (target) => target instanceof Element ? target.closest(selector) : null;
      const canAnimate = (control) => control && !control.matches(ignore)
        && (!ignoreId || control.id !== ignoreId);
      const playBounce = (control) => {
        if (reducedMotion.matches || !canAnimate(control)) return;
        const previousTimer = reboundTimers.get(control);
        if (previousTimer) window.clearTimeout(previousTimer);
        control.classList.remove("control-bounce-release");
        void control.offsetWidth;
        control.classList.add("control-bounce-release");
        let delay = 820;
        if (durationFromStyle) {
          const reboundDuration = getComputedStyle(control).getPropertyValue("--xyj-motion-rebound").trim();
          const durationMatch = reboundDuration.match(/^([\d.]+)(ms|s)$/);
          const reboundMs = durationMatch
            ? Number(durationMatch[1]) * (durationMatch[2] === "s" ? 1000 : 1)
            : 700;
          delay = Math.max(820, Math.ceil(reboundMs) + 120);
        }
        const timer = window.setTimeout(() => {
          control.classList.remove("control-bounce-release");
          reboundTimers.delete(control);
        }, delay);
        reboundTimers.set(control, timer);
      };
      const beginPress = (control) => {
        const previousTimer = reboundTimers.get(control);
        if (previousTimer) window.clearTimeout(previousTimer);
        reboundTimers.delete(control);
        control.classList.remove("control-bounce-release");
        control.classList.add("is-control-pressed");
      };
      const release = (control) => {
        if (control) {
          control.classList.remove("is-control-pressed");
          playBounce(control);
        }
        pressedBloom?.remove();
        pressedBloom = null;
      };

      const cancelPress = () => {
        pressedControl?.classList.remove("is-control-pressed");
        pressedBloom?.remove();
        pressedControl = null;
        pressedBloom = null;
      };
      document.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const control = findControl(event.target);
        if (!canAnimate(control)) return;
        cancelPress();
        pressedControl = control;
        beginPress(control);
        pressedBloom = emitHarmonyLightBloom(control, { x: event.clientX, y: event.clientY });
      });
      window.addEventListener("pointerup", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        release(pressedControl);
        pressedControl = null;
      });
      window.addEventListener("pointercancel", cancelPress);
      document.addEventListener("keydown", (event) => {
        if (!['Enter', ' '].includes(event.key) || event.repeat) return;
        const control = findControl(event.target);
        if (canAnimate(control)) {
          cancelPress();
          pressedControl = control;
          beginPress(control);
          pressedBloom = emitHarmonyLightBloom(control);
        }
      });
      document.addEventListener("keyup", (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        release(pressedControl || findControl(event.target));
        pressedControl = null;
      });
      window.addEventListener("blur", cancelPress);
    }
