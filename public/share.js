(() => {
  "use strict";
  const token = location.pathname.match(/^\/share\/([a-f0-9]{64})\/?$/)?.[1];
  const prefix = `/api/shares/${token}`;
  const node = id => document.getElementById(id);
  const state = { data: null, article: null, folder: "", loading: 0, pdf: false, authenticated: false };
  async function api(path) {
    const response = await fetch(path, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || "分享内容暂时无法打开"); error.status = response.status; throw error; }
    return data;
  }
  function expire(message) {
    node("share-title").textContent = "分享链接已失效";
    node("share-status").textContent = message;
    node("share-works").replaceChildren(); node("share-folders").replaceChildren();
    node("share-reader").hidden = true; node("reader-body").replaceChildren(); node("reader-attachments").replaceChildren();
    state.data = null; state.article = null;
  }
  function promptLogin(next = "/") {
    let target;
    try { target = new URL(next, location.origin); } catch { target = new URL("/", location.origin); }
    const safe = target.origin === location.origin ? target.pathname + target.search + target.hash : "/";
    node("share-login").href = `/login?next=${encodeURIComponent(safe)}`;
    node("share-register").href = `/login?mode=register&next=${encodeURIComponent(safe)}`;
    if (!node("share-login-dialog").open) node("share-login-dialog").showModal();
  }
  document.addEventListener("click", event => {
    const control = event.target.closest("a,button[data-login-prompt]");
    if (!control || control.closest("#share-login-dialog")) return;
    if (control.hasAttribute("data-login-prompt")) { event.preventDefault(); promptLogin(); return; }
    if (control.tagName !== "A") return;
    const url = new URL(control.href, location.origin);
    // Only server-issued scoped bytes and local share navigation are allowed.
    if (url.origin === location.origin && (url.pathname.startsWith(prefix + "/") && control.hasAttribute("data-share-resource")
      || url.pathname === location.pathname && url.hash)) return;
    if (state.authenticated && control.hasAttribute("data-site-navigation")) return;
    event.preventDefault(); promptLogin(control.getAttribute("href"));
  });
  // Middle-click is also a navigation gesture; it must not skip the gate.
  document.addEventListener("auxclick", event => {
    const anchor = event.target.closest("a");
    if (event.button !== 1 || !anchor || anchor.closest("#share-login-dialog") || anchor.hasAttribute("data-share-resource")) return;
    if (!state.authenticated || !anchor.hasAttribute("data-site-navigation")) { event.preventDefault(); promptLogin(anchor.getAttribute("href")); }
  });
  node("share-login-close").addEventListener("click", () => node("share-login-dialog").close());
  function scopedLink(label, url) {
    const link = document.createElement("a"); link.className = "primary"; link.textContent = label; link.href = url;
    link.dataset.shareResource = ""; return link;
  }
  function card(title) {
    const item = document.createElement("section"); item.className = "work-card";
    const info = document.createElement("div"); info.className = "work-info";
    const heading = document.createElement("h2"); heading.textContent = title;
    const actions = document.createElement("div"); actions.className = "work-actions";
    info.append(heading, actions); item.append(info); return { item, info, actions };
  }
  function assetCard(asset) {
    const { item, info, actions } = card(asset.title);
    if (asset.kind === "video") {
      const video = document.createElement("video"); video.controls = true; video.preload = "metadata"; video.src = asset.url;
      if (asset.posterUrl) video.poster = asset.posterUrl; item.prepend(video);
    }
    const meta = document.createElement("p"); meta.textContent = `${asset.kind.toUpperCase()} · ${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
    info.insertBefore(meta, actions);
    actions.append(scopedLink("下载文件", asset.downloadUrl));
    if (asset.kind === "pdf") { const preview = scopedLink("浏览 PDF", asset.url); preview.target = "_blank"; preview.rel = "noopener"; actions.append(preview); }
    return item;
  }
  function renderWorks() {
    const data = state.data; if (!data) return;
    const host = node("share-works"); host.replaceChildren();
    const includes = item => !state.folder || item.subsectionId === state.folder;
    for (const article of data.content.filter(includes)) {
      const { item, actions } = card(article.title);
      const open = document.createElement("button"); open.type = "button"; open.textContent = "浏览文章";
      open.addEventListener("click", () => openArticle(article.id)); actions.append(open); host.append(item);
    }
    for (const photo of data.media.filter(item => item.role === "item" && includes(item))) {
      const { item, actions } = card(photo.title); const image = document.createElement("img");
      image.src = photo.url; image.alt = photo.title; image.loading = "lazy"; item.prepend(image);
      if (data.kind === "media") item.classList.add("single-image");
      const preview = scopedLink("浏览大图", photo.url); preview.target = "_blank"; preview.rel = "noopener";
      actions.append(preview, scopedLink("下载原图", photo.downloadUrl)); host.append(item);
    }
    for (const asset of data.assets.filter(item => (!item.contentId || data.kind === "asset") && includes(item))) host.append(assetCard(asset));
    if (!host.children.length) { const empty = document.createElement("p"); empty.textContent = "这个分享范围内暂无已发布作品。"; host.append(empty); }
  }
  function renderFolders() {
    const host = node("share-folders"); host.replaceChildren(); host.hidden = state.data.kind !== "subsection";
    if (host.hidden) return;
    for (const folder of [{ id: "", name: "全部分享作品" }, ...state.data.subsections]) {
      const control = document.createElement("button"); control.type = "button"; control.textContent = folder.name;
      control.classList.toggle("active", state.folder === folder.id); control.setAttribute("aria-pressed", String(state.folder === folder.id));
      control.addEventListener("click", () => { state.folder = folder.id; showList(); renderFolders(); renderWorks(); }); host.append(control);
    }
  }
  function showList() {
    state.loading++; state.article = null; node("share-reader").hidden = true; node("share-works").hidden = false;
    node("reader-body").replaceChildren(); node("reader-attachments").replaceChildren();
  }
  node("share-back").addEventListener("click", showList);
  async function openArticle(id) {
    const generation = ++state.loading;
    node("share-status").textContent = "正在打开文章…";
    try {
      const article = await api(`${prefix}/content/${encodeURIComponent(id)}`);
      if (generation !== state.loading || !state.data) return;
      state.article = article; node("share-reader").hidden = false; node("share-works").hidden = true;
      node("share-back").hidden = state.data.kind === "content";
      node("reader-title").textContent = article.title;
      node("reader-meta").textContent = `发布于 ${new Date(article.published_at).toLocaleString("zh-CN")} · 更新于 ${new Date(article.updated_at).toLocaleString("zh-CN")}`;
      node("reader-body").innerHTML = article.body_html;
      node("reader-body").querySelectorAll(".resource-embed[data-resource-id]").forEach(element => {
        const asset = state.data.assets.find(item => item.id === element.dataset.resourceId);
        if (asset) element.replaceChildren(assetCard(asset));
        else element.textContent = "此附件未包含在分享中";
      });
      const attachments = node("reader-attachments"); attachments.replaceChildren();
      const embedded = new Set([...node("reader-body").querySelectorAll(".resource-embed[data-resource-id]")].map(element => element.dataset.resourceId));
      state.data.assets.filter(asset => asset.contentId === article.id && !embedded.has(asset.id)).forEach(asset => attachments.append(assetCard(asset)));
      node("share-status").textContent = "可浏览和下载本次分享的作品；访问更多内容请注册／登录。";
    } catch (error) {
      if (error.status === 410) expire(error.message); else node("share-status").textContent = error.message;
    }
  }
  let pdfLibrary;
  async function loadPdf() {
    if (window.html2pdf) return;
    if (!pdfLibrary) pdfLibrary = new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "/pdf-engine.js";
      script.onload = () => window.html2pdf ? resolve() : reject(new Error("PDF 组件未加载"));
      script.onerror = () => { pdfLibrary = null; script.remove(); reject(new Error("PDF 组件加载失败，请重试")); };
      document.head.append(script);
    });
    await pdfLibrary;
  }
  node("share-pdf").addEventListener("click", async () => {
    if (!state.article || state.pdf) return;
    const id = state.article.id, button = node("share-pdf"); state.pdf = true; button.disabled = true; button.textContent = "正在生成 PDF…";
    let root;
    try {
      const article = await api(`${prefix}/content/${id}?download=1`); await loadPdf();
      root = document.createElement("article"); root.className = "share-pdf-export";
      const title = document.createElement("h1"); title.textContent = article.title;
      const body = document.createElement("div"); body.innerHTML = article.body_html;
      body.querySelectorAll(".resource-embed").forEach(element => element.remove());
      root.append(title, body); document.body.append(root);
      await Promise.all([...body.querySelectorAll("img")].map(image => new Promise(resolve => {
        if (image.complete) return resolve(); const timer = setTimeout(resolve, 10000);
        const done = () => { clearTimeout(timer); resolve(); }; image.onload = done; image.onerror = done;
      })));
      // Revalidate after image/PDF loading too, so an in-progress withdrawal stops export.
      await api(`${prefix}/content/${id}?download=1`);
      const filename = (article.title || "文章").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) + ".pdf";
      await window.html2pdf().set({ margin: [12, 12, 14, 12], filename, image: { type: "jpeg", quality: .98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["css", "legacy"], avoid: ["img", "pre", "blockquote"] } }).from(root).save();
    } catch (error) { if (error.status === 410) expire(error.message); else node("share-status").textContent = `PDF 下载失败：${error.message}`; }
    finally { root?.remove(); state.pdf = false; button.disabled = false; button.textContent = "下载文章 PDF"; }
  });
  async function start() {
    if (!token) { expire("链接格式无效，请向站长索取新的分享链接。"); return; }
    try {
      const data = await api(prefix); state.data = data;
      node("share-title").textContent = data.title; document.title = `${data.title} · 星月集分享`;
      node("share-description").textContent = data.description;
      node("share-status").textContent = "可直接浏览和下载分享的作品；访问更多内容请注册／登录。";
      renderFolders(); renderWorks(); if (data.kind === "content") await openArticle(data.targetId);
      const session = await api("/api/auth/session").catch(() => null);
      state.authenticated = Boolean(session?.user?.fullAccess);
    } catch (error) { expire(error.message); }
  }
  // Open pages also stop showing content once the owner revokes their link.
  setInterval(async () => {
    if (document.hidden || !state.data) return;
    try { await api(prefix); } catch (error) { if (error.status === 410) expire(error.message); }
  }, 30000);
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !state.data) return;
    try { await api(prefix); } catch (error) { if (error.status === 410) expire(error.message); }
  });
  start();
})();
