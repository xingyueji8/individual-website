(() => {
  "use strict";

  const sidebar = document.querySelector(".sidebar");
  const appShell = sidebar?.closest(".app-shell");
  const sidebarNav = sidebar?.querySelector(".nav");
  const sidebarNote = sidebar?.querySelector(".sidebar-note");
  const mainMessages = document.getElementById("chat-messages");
  const mainForm = document.getElementById("chat-form");
  const mainInput = document.getElementById("chat-input");
  const mainStatus = document.getElementById("chat-status");
  if (!appShell || !sidebar || !sidebarNav || !sidebarNote || !mainMessages || !mainForm || !mainInput || !mainStatus) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* The pet overlays the sidebar's real free space and never enters its flex flow. */
  const stage = document.createElement("div");
  stage.className = "agent-pet-stage";
  const pet = document.createElement("button");
  pet.type = "button";
  pet.id = "agent-pet-control";
  pet.className = "agent-pet";
  pet.draggable = false;
  pet.dataset.state = "idle";
  pet.dataset.moving = "false";
  pet.title = "和小伙伴聊聊";
  pet.setAttribute("aria-label", "打开小伙伴对话");
  const sprite = document.createElement("span");
  sprite.className = "agent-pet-sprite";
  sprite.setAttribute("aria-hidden", "true");
  pet.append(sprite);
  stage.append(pet);
  sidebar.append(stage);

  /* Keep the full AI page intact. The pet owns a separate, deliberately small chat. */
  const panel = document.createElement("section");
  panel.className = "agent-dialog";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "小伙伴对话");
  panel.innerHTML = `<div class="agent-dialog-tail" aria-hidden="true"></div>
    <header class="agent-dialog-head"><strong>AI 小伙伴</strong><span>聊天或查找站内资源</span></header>`;
  const petMessages = document.createElement("div");
  petMessages.className = "chat-messages agent-mini-messages";
  petMessages.setAttribute("aria-live", "polite");
  const greeting = document.createElement("div");
  greeting.className = "bubble ai";
  greeting.textContent = "你好呀，需要我帮你找什么？";
  petMessages.append(greeting);
  panel.append(petMessages);
  const resizeDirections = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  resizeDirections.forEach(direction => {
    const handle = document.createElement("span");
    handle.className = `agent-resize-handle is-${direction}`;
    handle.dataset.resize = direction;
    handle.setAttribute("aria-hidden", "true");
    panel.append(handle);
  });
  document.body.append(panel);

  const composer = document.createElement("div");
  composer.className = "agent-composer";
  composer.hidden = true;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "agent-close";
  close.title = "关闭对话";
  close.setAttribute("aria-label", "关闭小伙伴对话");
  close.textContent = "×";
  const petForm = document.createElement("form");
  petForm.className = "agent-form";
  const petInput = document.createElement("textarea");
  petInput.maxLength = 3000;
  petInput.rows = 1;
  petInput.autocomplete = "off";
  petInput.placeholder = "发送消息，或查找站内资源…";
  petInput.setAttribute("aria-label", "发送消息，或查找站内资源");
  const petSubmit = document.createElement("button");
  petSubmit.type = "submit";
  petSubmit.className = "btn";
  petSubmit.textContent = "发送";
  const petStatus = document.createElement("div");
  petStatus.className = "chat-status";
  petStatus.setAttribute("role", "status");
  petForm.append(petInput, petSubmit);
  composer.append(close, petForm, petStatus);
  document.body.append(composer);

  const pending = new Map();
  let busy = false;
  let confirmBusy = false;
  let controller = null;
  let controllerTarget = null;
  let petTimer = null;
  let sidebarRelayoutTimer = null;
  let petActionToken = 0;
  let lastPetAction = "idle";
  let petOpen = false;
  let petHovered = false;
  let petX = 0;
  let petY = 0;
  let petPositioned = false;
  let petDetached = false;
  let petDrag = null;
  let suppressPetClick = false;
  let activeMovement = null;
  let dialogResize = null;
  let dialogUserPositioned = false;

  function approved() {
    try { return hasFullAccess(); } catch { return false; }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function scrollOutput(target) {
    target.scrollTop = target.scrollHeight;
  }

  function petStyleHost() {
    return petDetached ? pet : stage;
  }

  function applyPetPosition() {
    const host = petStyleHost();
    host.style.setProperty("--pet-x", `${Math.round(petX)}px`);
    host.style.setProperty("--pet-y", `${Math.round(petY)}px`);
  }

  function setPetActionDuration(value) {
    petStyleHost().style.setProperty("--pet-action-duration", value);
  }

  function keepDetachedInViewport() {
    if (!petDetached) return;
    petX = clamp(petX, 6, Math.max(6, innerWidth - pet.offsetWidth - 6));
    petY = clamp(petY, 6, Math.max(6, innerHeight - pet.offsetHeight - 6));
    applyPetPosition();
  }

  function sidebarBlankBounds() {
    const sidebarRect = sidebar.getBoundingClientRect();
    const navRect = sidebarNav.getBoundingClientRect();
    const noteRect = sidebarNote.getBoundingClientRect();
    return {
      left: sidebarRect.left + 4,
      right: sidebarRect.right - 4,
      top: Math.max(sidebarRect.top + 4, navRect.bottom + 8),
      bottom: Math.min(sidebarRect.bottom - 4, noteRect.top - 8),
    };
  }

  function isOverSidebarBlank(left, top) {
    const bounds = sidebarBlankBounds();
    const centerX = left + pet.offsetWidth / 2;
    const centerY = top + pet.offsetHeight / 2;
    return centerX >= bounds.left && centerX <= bounds.right
      && centerY >= bounds.top && centerY <= bounds.bottom;
  }

  function updateDialogPosition() {
    if (panel.hidden || !pet.isConnected) return;
    const rect = pet.getBoundingClientRect();
    if (dialogResize) return;
    const maxWidth = Math.max(1, innerWidth - 20);
    const maxHeight = Math.max(1, innerHeight - 20);
    if (panel.offsetWidth > maxWidth) panel.style.width = `${maxWidth}px`;
    if (panel.offsetHeight > maxHeight) panel.style.height = `${maxHeight}px`;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    if (dialogUserPositioned) {
      const current = panel.getBoundingClientRect();
      const left = clamp(current.left, 10, Math.max(10, innerWidth - width - 10));
      const top = clamp(current.top, 10, Math.max(10, innerHeight - height - 10));
      const petAbove = rect.bottom < top + height / 2;
      panel.classList.toggle("tail-on-top", petAbove);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.setProperty("--agent-tail-x", `${Math.round(clamp(rect.left + rect.width / 2 - left - 10, 18, Math.max(18, width - 34)))}px`);
      return;
    }

    const left = clamp(rect.left + rect.width / 2 - 42, 10, innerWidth - width - 10);
    let top = rect.top - height - 13;
    const below = top < 10;
    if (below) top = Math.min(innerHeight - height - 10, rect.bottom + 13);
    panel.classList.toggle("tail-on-top", below);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.max(10, top))}px`;
    panel.style.setProperty("--agent-tail-x", `${Math.round(clamp(rect.left + rect.width / 2 - left - 10, 18, width - 34))}px`);
  }

  function layoutStage() {
    const sidebarRect = sidebar.getBoundingClientRect();
    const navRect = sidebarNav.getBoundingClientRect();
    const noteRect = sidebarNote.getBoundingClientRect();
    /* Anchor below Settings; a short free area may overflow, but must never hide the character. */
    const top = Math.max(0, navRect.bottom - sidebarRect.top + 20);
    const bottom = Math.max(0, sidebarRect.bottom - noteRect.top + 6);
    stage.style.top = `${Math.round(top)}px`;
    stage.style.bottom = `${Math.round(bottom)}px`;

    const wasUnavailable = stage.classList.contains("is-unavailable");
    /*
      Expanded sidebars can have less than one character-height of free space
      between Settings and the footer. That is a positioning constraint, not a
      reason to hide the pet: overflow keeps it on the sidebar surface while
      its top edge remains safely below the navigation.
    */
    const canShow = !appShell.hidden;
    stage.classList.toggle("is-unavailable", !canShow);
    pet.classList.toggle("is-screen-hidden", !canShow);
    if (!canShow) {
      if (!appShell.hidden && !petOpen && !petHovered && !reducedMotion.matches && petTimer === null) {
        schedulePet(850);
      }
      return;
    }

    if (petDetached) {
      keepDetachedInViewport();
      updateDialogPosition();
      return;
    }

    const maxX = Math.max(0, stage.clientWidth - pet.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - pet.offsetHeight);
    if (!petPositioned) {
      petX = maxX / 2;
      petY = maxY;
      petPositioned = true;
    }
    petX = clamp(petX, 0, maxX);
    petY = clamp(petY, 0, maxY);
    applyPetPosition();
    updateDialogPosition();
    if (wasUnavailable && !petOpen && !petHovered && !reducedMotion.matches && petTimer === null) {
      schedulePet(1200);
    }
  }

  function pickNaturalAction() {
    const roll = Math.random();
    const collapsed = appShell.classList.contains("sidebar-collapsed");

    /* Never chain a sprint directly into sitting or another sprint. */
    if (lastPetAction === "run" || lastPetAction === "walk") {
      if (roll < .34) return "idle";
      if (roll < .62) return "wave";
      if (roll < .78) return "jump";
      return "walk";
    }
    if (lastPetAction === "sit") {
      if (roll < .42) return "idle";
      if (roll < .70) return "wave";
      if (roll < .91) return "walk";
      return "jump";
    }
    /* The collapsed rail is too narrow for a believable sprint. */
    if (collapsed) {
      if (roll < .24) return "walk";
      if (roll < .47) return "wave";
      if (roll < .58) return "jump";
      if (roll < .73) return "sit";
      return "idle";
    }
    if (roll < .34) return "walk";
    if (roll < .42) return "run";
    if (roll < .58) return "wave";
    if (roll < .68) return "jump";
    if (roll < .80) return "sit";
    return "idle";
  }

  function clearPetTimer() {
    if (petTimer !== null) clearTimeout(petTimer);
    petTimer = null;
  }

  function schedulePet(delay, callback = movePet) {
    clearPetTimer();
    petTimer = setTimeout(() => {
      petTimer = null;
      callback();
    }, Math.max(0, delay));
  }

  function chooseMovementTarget(action) {
    const maxX = Math.max(0, stage.clientWidth - pet.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - pet.offsetHeight);
    /* The artwork faces horizontally, so never fake a walk by sliding vertically. */
    const edgeInset = Math.min(4, maxX / 2);
    const minX = edgeInset;
    const safeMaxX = Math.max(minX, maxX - edgeInset);
    const horizontalSpan = safeMaxX - minX;
    const minimumTravel = action === "run" ? 48 : 24;
    if (horizontalSpan < minimumTravel) return null;

    const currentX = clamp(petX, minX, safeMaxX);
    const roomLeft = currentX - minX;
    const roomRight = safeMaxX - currentX;
    let direction;
    if (roomRight < minimumTravel) direction = -1;
    else if (roomLeft < minimumTravel) direction = 1;
    else direction = Math.random() < .5 ? -1 : 1;

    let available = direction > 0 ? roomRight : roomLeft;
    if (available < minimumTravel) {
      direction *= -1;
      available = direction > 0 ? roomRight : roomLeft;
    }
    if (available < minimumTravel) return null;

    const desiredTravel = action === "run"
      ? 56 + Math.random() * 46
      : 28 + Math.random() * 42;
    const travel = Math.min(available, Math.max(minimumTravel, desiredTravel));
    const nextX = clamp(currentX + direction * travel, minX, safeMaxX);
    const nextY = clamp(petY + (Math.random() * 2 - 1) * 6, 0, maxY);
    const distance = Math.hypot(nextX - currentX, nextY - petY);
    if (distance < minimumTravel - 1) return null;
    return { x: nextX, y: nextY, distance, direction };
  }

  function stationaryActionDuration(action) {
    if (action === "wave") return 1.9 + Math.random() * .55;
    if (action === "jump") return 1.3 + Math.random() * .25;
    if (action === "sit") return 5.8 + Math.random() * 2.8;
    return 3.2 + Math.random() * 3.2;
  }

  function finishPetAction(action, token) {
    if (token !== petActionToken) return;
    activeMovement = null;
    pet.dataset.moving = "false";
    if (petDetached) {
      pet.dataset.state = "sit";
      pet.classList.add("is-motion-frozen");
      return;
    }
    if (petOpen || petHovered) return;
    pet.dataset.state = "idle";
    lastPetAction = action;

    const rest = action === "run"
      ? 3400 + Math.random() * 2200
      : action === "walk"
        ? 2400 + Math.random() * 2000
        : action === "sit"
          ? 2800 + Math.random() * 1800
          : action === "idle"
            ? 1100 + Math.random() * 1200
            : 1800 + Math.random() * 1600;
    schedulePet(rest);
  }

  /*
    A CSS transform can still be travelling after its timer has been cleared.
    Capture the painted position so clicking, hovering or changing sidebar
    width never separates the hit target from the visible character.
  */
  function freezePetMotion() {
    petActionToken += 1;
    clearPetTimer();
    activeMovement = null;
    const petRect = pet.getBoundingClientRect();
    if (petDetached) {
      petX = clamp(petRect.left, 6, Math.max(6, innerWidth - pet.offsetWidth - 6));
      petY = clamp(petRect.top, 6, Math.max(6, innerHeight - pet.offsetHeight - 6));
    } else {
      const stageRect = stage.getBoundingClientRect();
      const maxX = Math.max(0, stage.clientWidth - pet.offsetWidth);
      const maxY = Math.max(0, stage.clientHeight - pet.offsetHeight);
      petX = clamp(petRect.left - stageRect.left, 0, maxX);
      petY = clamp(petRect.top - stageRect.top, 0, maxY);
    }
    pet.dataset.moving = "false";
    pet.classList.add("is-motion-frozen");
    applyPetPosition();
  }

  function greetPet() {
    if (petDetached || petDrag) return;
    petHovered = true;
    freezePetMotion();
    setPetActionDuration("2.1s");
    pet.dataset.state = "wave";
  }

  function finishGreeting() {
    if (petDrag) return;
    petHovered = false;
    if (petOpen) return;
    if (petDetached) {
      pet.dataset.moving = "false";
      pet.dataset.state = "sit";
      return;
    }
    pet.classList.remove("is-motion-frozen");
    pet.dataset.moving = "false";
    pet.dataset.state = "idle";
    schedulePet(1500);
  }

  function movePet() {
    if (petOpen || petHovered) return;
    if (petDetached) {
      clearPetTimer();
      pet.dataset.moving = "false";
      pet.dataset.state = "sit";
      return;
    }
    if (stage.classList.contains("is-unavailable")) {
      if (!appShell.hidden) schedulePet(850);
      return;
    }
    if (reducedMotion.matches) {
      pet.dataset.moving = "false";
      pet.dataset.state = "idle";
      return;
    }

    const action = pickNaturalAction();
    const moving = action === "walk" || action === "run";
    const token = ++petActionToken;
    lastPetAction = action;

    if (moving) {
      const target = chooseMovementTarget(action);
      /* A walking or running pose is never shown without real displacement. */
      if (!target) {
        pet.dataset.moving = "false";
        pet.dataset.state = "idle";
        lastPetAction = "idle";
        schedulePet(2400 + Math.random() * 1800);
        return;
      }

      const speed = action === "run" ? 58 : 28;
      const duration = clamp(
        target.distance / speed,
        action === "run" ? 1.8 : 2.3,
        action === "run" ? 3.8 : 5.2
      );
      pet.classList.toggle("is-facing-left", target.direction < 0);
      pet.classList.remove("is-motion-frozen");
      pet.dataset.moving = "true";
      pet.dataset.state = action;
      stage.style.setProperty("--pet-duration", `${duration.toFixed(2)}s`);
      stage.style.setProperty("--pet-easing", "linear");
      stage.style.setProperty("--pet-action-duration", `${duration.toFixed(2)}s`);

      /* Commit the body pose first, then begin actual travel on the next frame. */
      pet.getBoundingClientRect();
      requestAnimationFrame(() => {
        if (token !== petActionToken || petOpen || petHovered || petDetached || stage.classList.contains("is-unavailable")) return;
        const startRect = pet.getBoundingClientRect();
        petX = target.x;
        petY = target.y;
        activeMovement = { action, token, startLeft: startRect.left, startTop: startRect.top, expected: target.distance };
        applyPetPosition();
        schedulePet(duration * 1000 + 180, () => finishPetAction(action, token));
      });
      return;
    }

    const duration = stationaryActionDuration(action);
    pet.dataset.moving = "false";
    pet.dataset.state = action;
    setPetActionDuration(`${duration.toFixed(2)}s`);
    schedulePet(duration * 1000, () => finishPetAction(action, token));
  }

  function finishMovementFromTransition(event) {
    if (event.propertyName !== "transform" || event.target !== pet || !activeMovement) return;
    const movement = activeMovement;
    if (movement.token !== petActionToken) return;
    const rect = pet.getBoundingClientRect();
    const actualDistance = Math.hypot(rect.left - movement.startLeft, rect.top - movement.startTop);
    /* Even if another stylesheet ever blocks travel again, never leave a running pose at a wall. */
    if (actualDistance < Math.min(8, movement.expected * .2)) {
      pet.dataset.moving = "false";
      pet.dataset.state = "idle";
    }
    finishPetAction(movement.action, movement.token);
  }

  function beginSidebarRelayout() {
    clearTimeout(sidebarRelayoutTimer);
    if (petDetached) {
      layoutStage();
      return;
    }
    freezePetMotion();
    pet.dataset.state = "idle";
    layoutStage();
    sidebarRelayoutTimer = setTimeout(finishSidebarRelayout, 560);
  }

  function finishSidebarRelayout() {
    clearTimeout(sidebarRelayoutTimer);
    sidebarRelayoutTimer = null;
    layoutStage();
    if (petDetached) return;
    if (!petOpen && !petHovered && !stage.classList.contains("is-unavailable")) {
      pet.classList.remove("is-motion-frozen");
      pet.dataset.moving = "false";
      pet.dataset.state = "idle";
      schedulePet(1500);
    }
  }

  function detachPetAt(left, top) {
    if (!petDetached) {
      petDetached = true;
      document.body.append(pet);
      pet.classList.add("is-detached");
    }
    petX = left;
    petY = top;
    pet.classList.add("is-motion-frozen");
    keepDetachedInViewport();
  }

  function dockPetAt(left, top) {
    const stageRect = stage.getBoundingClientRect();
    petDetached = false;
    stage.append(pet);
    pet.classList.remove("is-detached", "is-dragging");
    pet.style.removeProperty("--pet-x");
    pet.style.removeProperty("--pet-y");
    pet.style.removeProperty("--pet-duration");
    pet.style.removeProperty("--pet-easing");
    pet.style.removeProperty("--pet-action-duration");
    const maxX = Math.max(0, stage.clientWidth - pet.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - pet.offsetHeight);
    petX = clamp(left - stageRect.left, 0, maxX);
    petY = clamp(top - stageRect.top, 0, maxY);
    petPositioned = true;
    applyPetPosition();
    pet.dataset.moving = "false";
    if (petOpen) {
      pet.dataset.state = "wave";
      setPetActionDuration("2.1s");
    } else {
      pet.dataset.state = "idle";
      pet.classList.remove("is-motion-frozen");
      schedulePet(1300);
    }
  }

  function beginPetDrag(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    freezePetMotion();
    petHovered = false;
    const rect = pet.getBoundingClientRect();
    petDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    try { pet.setPointerCapture(event.pointerId); } catch {}
  }

  function moveDraggedPet(event) {
    if (!petDrag || event.pointerId !== petDrag.pointerId) return;
    const distance = Math.hypot(event.clientX - petDrag.startX, event.clientY - petDrag.startY);
    if (!petDrag.moved && distance < 5) return;
    if (!petDrag.moved) {
      petDrag.moved = true;
      suppressPetClick = true;
      detachPetAt(petDrag.startLeft, petDrag.startTop);
      pet.classList.add("is-dragging");
      try { pet.setPointerCapture(event.pointerId); } catch {}
    }
    event.preventDefault();
    petX = clamp(event.clientX - petDrag.offsetX, 6, Math.max(6, innerWidth - pet.offsetWidth - 6));
    petY = clamp(event.clientY - petDrag.offsetY, 6, Math.max(6, innerHeight - pet.offsetHeight - 6));
    applyPetPosition();
    pet.dataset.moving = "false";
    pet.dataset.state = isOverSidebarBlank(petX, petY) ? "idle" : "sit";
    updateDialogPosition();
  }

  function finishPetDrag(event) {
    if (!petDrag || event.pointerId !== petDrag.pointerId) return;
    const moved = petDrag.moved;
    petDrag = null;
    try { pet.releasePointerCapture(event.pointerId); } catch {}
    pet.classList.remove("is-dragging");
    if (!moved) return;

    const left = petX;
    const top = petY;
    if (isOverSidebarBlank(left, top)) {
      dockPetAt(left, top);
    } else {
      pet.dataset.moving = "false";
      pet.dataset.state = "sit";
      pet.classList.add("is-motion-frozen");
    }
    updateDialogPosition();
    setTimeout(() => { suppressPetClick = false; }, 0);
  }

  function beginDialogResize(event) {
    const handle = event.target.closest?.(".agent-resize-handle");
    if (!handle || event.button !== 0 || event.isPrimary === false) return;
    const rect = panel.getBoundingClientRect();
    dialogResize = {
      pointerId: event.pointerId,
      direction: handle.dataset.resize,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
    dialogUserPositioned = true;
    panel.classList.add("is-resizing", "is-user-sized");
    document.body.classList.add("agent-dialog-resizing");
    panel.style.width = `${Math.round(rect.width)}px`;
    panel.style.height = `${Math.round(rect.height)}px`;
    panel.style.maxWidth = "none";
    panel.style.maxHeight = "none";
    event.preventDefault();
    event.stopPropagation();
    try { handle.setPointerCapture(event.pointerId); } catch {}
  }

  function resizeDialog(event) {
    if (!dialogResize || event.pointerId !== dialogResize.pointerId) return;
    const margin = 10;
    const minWidth = Math.min(240, innerWidth - margin * 2);
    const minHeight = Math.min(150, innerHeight - margin * 2);
    const dx = event.clientX - dialogResize.startX;
    const dy = event.clientY - dialogResize.startY;
    const direction = dialogResize.direction;
    let left = dialogResize.left;
    let top = dialogResize.top;
    let width = dialogResize.width;
    let height = dialogResize.height;

    if (direction.includes("e")) {
      width = clamp(dialogResize.width + dx, minWidth, innerWidth - margin - dialogResize.left);
    }
    if (direction.includes("s")) {
      height = clamp(dialogResize.height + dy, minHeight, innerHeight - margin - dialogResize.top);
    }
    if (direction.includes("w")) {
      left = clamp(dialogResize.left + dx, margin, dialogResize.right - minWidth);
      width = dialogResize.right - left;
    }
    if (direction.includes("n")) {
      top = clamp(dialogResize.top + dy, margin, dialogResize.bottom - minHeight);
      height = dialogResize.bottom - top;
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;
    event.preventDefault();
  }

  function finishDialogResize(event) {
    if (!dialogResize || event.pointerId !== dialogResize.pointerId) return;
    dialogResize = null;
    panel.classList.remove("is-resizing");
    document.body.classList.remove("agent-dialog-resizing");
    updateDialogPosition();
  }

  function setOpen(value) {
    if (value) freezePetMotion();
    petOpen = value;
    if (value) dialogUserPositioned = false;
    panel.hidden = !value;
    composer.hidden = !value;
    document.body.classList.toggle("agent-open", value);
    pet.classList.toggle("is-talking", value);
    clearPetTimer();
    if (value) {
      pet.dataset.moving = "false";
      setPetActionDuration("2.1s");
      pet.dataset.state = "wave";
      requestAnimationFrame(() => {
        updateDialogPosition();
        scrollOutput(petMessages);
        petInput.focus();
      });
    } else {
      if (petDetached) {
        petHovered = false;
        pet.dataset.moving = "false";
        pet.dataset.state = "sit";
        pet.classList.add("is-motion-frozen");
      } else if (petHovered) {
        pet.dataset.moving = "false";
        setPetActionDuration("2.1s");
        pet.dataset.state = "wave";
      } else {
        pet.classList.remove("is-motion-frozen");
        pet.dataset.moving = "false";
        pet.dataset.state = "idle";
        schedulePet(1500);
      }
    }
  }

  function open() {
    if (!approved()) {
      if (petDetached) {
        const token = ++petActionToken;
        pet.dataset.moving = "false";
        setPetActionDuration("2.1s");
        pet.dataset.state = "wave";
        schedulePet(2100, () => finishPetAction("wave", token));
      }
      try { showAuthLock("ai"); } catch {}
      return;
    }
    setOpen(true);
  }

  async function revokePending(target = null) {
    const tokens = [...pending.entries()].filter(([, value]) => !target || value.target === target).map(([token]) => token);
    tokens.forEach(token => pending.delete(token));
    await Promise.allSettled(tokens.map(token => api("/api/agent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })));
  }

  function closeAgent({ clear = false } = {}) {
    const closesActiveRequest = clear || controllerTarget === petMessages;
    if (closesActiveRequest) {
      controller?.abort();
      controller = null;
      controllerTarget = null;
      busy = false;
      confirmBusy = false;
    }
    setOpen(false);
    revokePending(clear ? null : petMessages);
    if (clear) {
      petMessages.querySelectorAll(".agent-resource-list,.agent-confirm-row").forEach(node => node.remove());
      petInput.value = "";
      petStatus.textContent = "";
    }
  }

  function resizePetInput() {
    petInput.style.height = "auto";
    petInput.style.height = `${Math.min(petInput.scrollHeight, 150)}px`;
  }

  function kindLabel(item) {
    if (item.kind === "content") return "文章 · PDF";
    if (item.kind === "media") return "图片 · 原片";
    return "文件与视频";
  }

  function byteLabel(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes, unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function addOutputBubble(target, role, text) {
    if (target === mainMessages) return addBubble(role, text);
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    target.append(bubble);
    scrollOutput(target);
    updateDialogPosition();
    return bubble;
  }

  function infoBubble(text, target) {
    const bubble = addOutputBubble(target, "ai", text);
    bubble.classList.add("agent-info");
    return bubble;
  }

  async function performDownload(result, item, button, target, statusNode) {
    if (result.kind !== item.kind || result.id !== item.id) throw new Error("下载目标不匹配");
    if (result.action === "export_pdf" && result.kind === "content") {
      statusNode.textContent = "正在生成 PDF…";
      await openContent(result.id);
      const pdfButton = document.getElementById("reader-print");
      if (!pdfButton || pdfButton.hidden) throw new Error("此文章当前不可下载");
      await downloadCurrentContentPdf(pdfButton);
    } else if (result.action === "download" && ["media", "asset"].includes(result.kind)) {
      const href = result.kind === "media"
        ? `/media/${encodeURIComponent(result.id)}?download=1`
        : `/files/${encodeURIComponent(result.id)}?download=1`;
      const link = document.createElement("a");
      link.href = protectedMediaUrl(href);
      link.download = item.title || "";
      document.body.append(link);
      link.click();
      link.remove();
    } else {
      throw new Error("不支持的操作");
    }
    button.textContent = "已请求下载";
    infoBubble("已请求浏览器下载，请查看下载列表。", target);
  }

  function showConfirm(card, item, token, selectButton, target, statusNode) {
    card.querySelector(".agent-confirm-row")?.remove();
    const row = document.createElement("div");
    row.className = "agent-confirm-row";
    const text = document.createElement("span");
    text.textContent = "确认下载此资源？确认有效期为五分钟。";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn small";
    yes.textContent = "确认下载";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn small ghost";
    cancel.textContent = "取消";
    row.append(text, yes, cancel);
    card.append(row);
    updateDialogPosition();

    cancel.addEventListener("click", async () => {
      if (confirmBusy || !pending.has(token)) return;
      confirmBusy = true;
      try {
        await api("/api/agent/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      } catch {}
      pending.delete(token);
      row.remove();
      selectButton.disabled = true;
      selectButton.textContent = "已取消";
      confirmBusy = false;
      updateDialogPosition();
    });

    yes.addEventListener("click", async () => {
      if (busy || confirmBusy || !pending.has(token)) return;
      confirmBusy = true;
      yes.disabled = true;
      cancel.disabled = true;
      statusNode.textContent = "正在确认权限…";
      try {
        const result = await api("/api/agent/confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, confirm: true }),
        });
        pending.delete(token);
        await performDownload(result, item, yes, target, statusNode);
        row.querySelector("span").textContent = "操作已确认";
        selectButton.disabled = true;
      } catch (error) {
        row.querySelector("span").textContent = error.message || "确认已失效，请重新查找资源";
        yes.disabled = false;
        cancel.disabled = false;
      } finally {
        statusNode.textContent = "";
        confirmBusy = false;
      }
    });
  }

  function renderResources(result, target, statusNode) {
    const bubble = infoBubble(result.items?.length
      ? "已找到可查看的资源，请选择后确认下载。"
      : "未找到匹配的可查看资源，请尝试更短的标题关键词。", target);
    if (!result.items?.length) return;
    if (result.total > result.items.length) {
      const note = document.createElement("p");
      note.className = "agent-result-note";
      note.textContent = "结果较多，仅显示前 12 项，请缩小关键词范围。";
      bubble.append(note);
    }
    const list = document.createElement("div");
    list.className = "agent-resource-list";
    result.items.forEach(item => {
      const card = document.createElement("article");
      card.className = "agent-resource-card";
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = item.title;
      name.setAttribute("translate", "no");
      name.dataset.noTranslate = "";
      const meta = document.createElement("small");
      meta.textContent = [kindLabel(item), byteLabel(item.size)].filter(Boolean).join(" · ");
      copy.append(name, meta);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn small";
      if (item.locked) {
        action.textContent = "内容已上锁";
        action.disabled = true;
        action.title = "内容已上锁，请先在个人空间解锁后重新查找。";
      } else if (!item.canDownload || !item.confirmationToken) {
        action.textContent = "不可下载";
        action.disabled = true;
        action.title = "此资源未向当前账号开放下载。";
      } else {
        action.textContent = "选择下载";
        const token = item.confirmationToken;
        pending.set(token, { item, target });
        action.addEventListener("click", () => showConfirm(card, item, token, action, target, statusNode));
      }
      card.append(copy, action);
      list.append(card);
    });
    bubble.append(list);
    scrollOutput(target);
    updateDialogPosition();
  }

  async function submit(sourceInput = mainInput) {
    if (busy || confirmBusy) return;
    if (!approved()) { try { showAuthLock("ai"); } catch {} return; }
    const fromPet = sourceInput === petInput;
    const input = fromPet ? petInput : mainInput;
    const form = fromPet ? petForm : mainForm;
    const target = fromPet ? petMessages : mainMessages;
    const statusNode = fromPet ? petStatus : mainStatus;
    const question = input.value.trim();
    if (!question) return;
    if (fromPet) setOpen(true);
    const userBubble = addOutputBubble(target, "user", question);
    userBubble.dataset.noTranslate = "";
    input.value = "";
    if (fromPet) resizePetInput();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    busy = true;
    const requestController = new AbortController();
    controller = requestController;
    controllerTarget = target;
    statusNode.textContent = "正在理解指令并查找资源…";
    try {
      const result = await api("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: requestController.signal,
      });
      if (result.mode === "resources") {
        renderResources(result, target, statusNode);
      } else {
        statusNode.textContent = "AI 正在生成回答…";
        const answer = addOutputBubble(target, "ai", "");
        answer.classList.add("streaming");
        try {
          await streamAiAnswer(question, answer, requestController.signal);
        } finally {
          answer.classList.remove("streaming");
          await typesetAiBubble(answer);
          scrollOutput(target);
          updateDialogPosition();
        }
      }
      statusNode.textContent = "";
    } catch (error) {
      if (error.name !== "AbortError") {
        infoBubble(`暂时无法完成：${error.message || "请求失败"}`, target);
        statusNode.textContent = "";
      }
    } finally {
      if (controller === requestController) {
        controller = null;
        controllerTarget = null;
        busy = false;
      }
      submitButton.disabled = false;
      if (fromPet && !composer.hidden) petInput.focus();
    }
  }

  pet.addEventListener("pointerenter", greetPet);
  pet.addEventListener("pointerleave", finishGreeting);
  pet.addEventListener("pointerdown", beginPetDrag);
  pet.addEventListener("transitionend", finishMovementFromTransition);
  pet.addEventListener("dragstart", event => event.preventDefault());
  pet.addEventListener("click", event => {
    if (suppressPetClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    open();
  });
  panel.addEventListener("pointerdown", beginDialogResize);
  addEventListener("pointermove", event => {
    moveDraggedPet(event);
    resizeDialog(event);
  }, { passive: false });
  addEventListener("pointerup", event => {
    finishPetDrag(event);
    finishDialogResize(event);
  });
  addEventListener("pointercancel", event => {
    finishPetDrag(event);
    finishDialogResize(event);
  });
  close.addEventListener("click", () => closeAgent());
  petForm.addEventListener("submit", event => {
    event.preventDefault();
    submit(petInput);
  });
  petInput.addEventListener("input", resizePetInput);
  petInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      petForm.requestSubmit();
    }
  });
  addEventListener("resize", layoutStage);
  sidebar.addEventListener("scroll", updateDialogPosition, { passive: true });

  let lastSidebarCollapsed = appShell.classList.contains("sidebar-collapsed");
  const sidebarModeObserver = new MutationObserver((mutations) => {
    const collapsed = appShell.classList.contains("sidebar-collapsed");
    if (collapsed !== lastSidebarCollapsed) {
      lastSidebarCollapsed = collapsed;
      beginSidebarRelayout();
      return;
    }
    if (mutations.some((mutation) => mutation.attributeName === "hidden")) {
      requestAnimationFrame(layoutStage);
    }
  });
  sidebarModeObserver.observe(appShell, { attributes: true, attributeFilter: ["class", "hidden"] });

  sidebar.addEventListener("transitionend", (event) => {
    if (["width", "flex-basis", "padding-left", "padding-right"].includes(event.propertyName)) {
      finishSidebarRelayout();
    }
  });

  if ("ResizeObserver" in window) {
    const petLayoutObserver = new ResizeObserver(layoutStage);
    petLayoutObserver.observe(sidebar);
    petLayoutObserver.observe(sidebarNav);
    petLayoutObserver.observe(sidebarNote);
  }
  requestAnimationFrame(() => {
    layoutStage();
    schedulePet(900);
  });

  /* AI sidebar navigation remains under the site's original section router. */
  window.SiteAgent = { open, close: closeAgent, submit };
})();
