(() => {
  "use strict";

  const sidebar = document.querySelector(".sidebar");
  const note = sidebar?.querySelector(".sidebar-note");
  const oldShell = document.querySelector("#ai-helper .chat-shell");
  const messages = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const oldInput = document.getElementById("chat-input");
  const status = document.getElementById("chat-status");
  if (!sidebar || !note || !oldShell || !messages || !form || !oldInput || !status) return;

  const stage = document.createElement("div");
  stage.className = "agent-pet-stage";
  stage.setAttribute("aria-label", "蓝发月亮卫衣小伙伴");
  const pet = document.createElement("button");
  pet.type = "button";
  pet.className = "agent-pet";
  pet.title = "打开 AI 对话";
  pet.setAttribute("aria-label", "打开 AI 对话");
  const petImage = document.createElement("img");
  petImage.src = "/assets/agent-companion.png";
  petImage.alt = "";
  petImage.draggable = false;
  pet.append(petImage);
  const petHint = document.createElement("span");
  petHint.className = "agent-pet-hint";
  petHint.textContent = "点我聊天";
  stage.append(pet, petHint);
  sidebar.insertBefore(stage, note);

  const panel = document.createElement("section");
  panel.className = "agent-dialog";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "对话记录");
  panel.innerHTML = `<div class="agent-dialog-tail" aria-hidden="true"></div>
    <header class="agent-dialog-head"><strong>AI 助手</strong><span>可聊天、查找并确认下载站内资源</span></header>`;
  const conversation = document.createElement("div");
  conversation.className = "agent-conversation";
  conversation.append(messages);
  panel.append(conversation);
  document.body.append(panel);

  const composer = document.createElement("div");
  composer.className = "agent-composer";
  composer.hidden = true;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "agent-close";
  close.title = "关闭对话";
  close.setAttribute("aria-label", "关闭对话");
  close.textContent = "×";
  const textarea = document.createElement("textarea");
  textarea.id = "chat-input";
  textarea.maxLength = 3000;
  textarea.rows = 1;
  textarea.autocomplete = "off";
  textarea.placeholder = "发送消息，或查找并下载站内资源…";
  textarea.setAttribute("aria-label", "发送消息，或查找并下载站内资源");
  oldInput.replaceWith(textarea);
  form.classList.add("agent-form");
  form.insertBefore(textarea, form.firstChild);
  composer.append(close, form, status);
  document.body.append(composer);

  const launch = document.createElement("button");
  launch.type = "button";
  launch.className = "btn agent-section-launch";
  launch.textContent = "打开 AI 对话";
  oldShell.replaceWith(launch);

  const pending = new Map();
  let busy = false;
  let confirmBusy = false;
  let controller = null;
  let walkTimer = null;

  function approved() {
    try { return hasFullAccess(); } catch { return false; }
  }

  function setOpen(value) {
    panel.hidden = !value;
    composer.hidden = !value;
    document.body.classList.toggle("agent-open", value);
    pet.classList.toggle("is-talking", value);
    if (value) {
      messages.scrollTop = messages.scrollHeight;
      textarea.focus();
    }
  }

  function open() {
    if (!approved()) {
      try { showAuthLock("ai"); } catch {}
      return;
    }
    setOpen(true);
  }

  async function revokePending() {
    const tokens = [...pending.keys()];
    pending.clear();
    await Promise.allSettled(tokens.map(token => api("/api/agent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })));
  }

  function closeAgent({ clear = false } = {}) {
    controller?.abort();
    controller = null;
    busy = false;
    confirmBusy = false;
    setOpen(false);
    revokePending();
    if (clear) {
      messages.querySelectorAll(".agent-resource-list,.agent-confirm-row").forEach(node => node.remove());
      textarea.value = "";
      status.textContent = "";
    }
  }

  function resizeInput() {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
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

  function infoBubble(text) {
    const bubble = addBubble("ai", text);
    bubble.classList.add("agent-info");
    return bubble;
  }

  async function performDownload(result, item, button) {
    if (result.kind !== item.kind || result.id !== item.id) throw new Error("下载目标不匹配");
    if (result.action === "export_pdf" && result.kind === "content") {
      status.textContent = "正在生成 PDF…";
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
    infoBubble("已请求浏览器下载，请查看下载列表。");
  }

  function showConfirm(card, item, token, selectButton) {
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
    });

    yes.addEventListener("click", async () => {
      if (busy || confirmBusy || !pending.has(token)) return;
      confirmBusy = true;
      yes.disabled = true;
      cancel.disabled = true;
      status.textContent = "正在确认权限…";
      try {
        const result = await api("/api/agent/confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, confirm: true }),
        });
        pending.delete(token);
        await performDownload(result, item, yes);
        row.querySelector("span").textContent = "操作已确认";
        selectButton.disabled = true;
      } catch (error) {
        row.querySelector("span").textContent = error.message || "确认已失效，请重新查找资源";
        yes.disabled = false;
        cancel.disabled = false;
      } finally {
        status.textContent = "";
        confirmBusy = false;
      }
    });
  }

  function renderResources(result) {
    const bubble = infoBubble(result.items?.length
      ? "已找到可查看的资源，请选择后确认下载。"
      : "未找到匹配的可查看资源，请尝试更短的标题关键词。");
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
        pending.set(token, item);
        action.addEventListener("click", () => showConfirm(card, item, token, action));
      }
      card.append(copy, action);
      list.append(card);
    });
    bubble.append(list);
    messages.scrollTop = messages.scrollHeight;
  }

  async function submit() {
    if (busy || confirmBusy) return;
    if (!approved()) { try { showAuthLock("ai"); } catch {} return; }
    const question = textarea.value.trim();
    if (!question) return;
    setOpen(true);
    const userBubble = addBubble("user", question);
    userBubble.dataset.noTranslate = "";
    textarea.value = "";
    resizeInput();
    form.querySelector('button[type="submit"]').disabled = true;
    busy = true;
    controller = new AbortController();
    status.textContent = "正在理解指令并查找资源…";
    try {
      const result = await api("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (result.mode === "resources") {
        renderResources(result);
      } else {
        status.textContent = "AI 正在生成回答…";
        const answer = addBubble("ai", "");
        answer.classList.add("streaming");
        try {
          await streamAiAnswer(question, answer, controller.signal);
        } finally {
          answer.classList.remove("streaming");
          await typesetAiBubble(answer);
        }
      }
      status.textContent = "";
    } catch (error) {
      if (error.name !== "AbortError") {
        infoBubble(`暂时无法完成：${error.message || "请求失败"}`);
        status.textContent = "";
      }
    } finally {
      controller = null;
      busy = false;
      form.querySelector('button[type="submit"]').disabled = false;
      if (!composer.hidden) textarea.focus();
    }
  }

  function wander() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || stage.clientWidth < 80) return;
    const maxX = Math.max(0, stage.clientWidth - pet.offsetWidth - 6);
    const maxY = Math.max(0, stage.clientHeight - pet.offsetHeight - 4);
    stage.style.setProperty("--pet-x", `${Math.round(Math.random() * maxX)}px`);
    stage.style.setProperty("--pet-y", `${Math.round(Math.random() * maxY)}px`);
    pet.classList.toggle("is-facing-left", Math.random() > .5);
    clearTimeout(walkTimer);
    walkTimer = setTimeout(wander, 3300 + Math.random() * 3600);
  }

  pet.addEventListener("click", open);
  launch.addEventListener("click", open);
  close.addEventListener("click", () => closeAgent());
  textarea.addEventListener("input", resizeInput);
  textarea.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelector('[data-section="ai-helper"]')?.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  }, true);
  addEventListener("resize", wander);
  wander();

  window.SiteAgent = { open, close: closeAgent, submit };
})();
