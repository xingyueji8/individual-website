/* Multi-page personal space. Routes are URL-backed; protected content still
 * comes exclusively from the existing access-aware APIs. */
function personalSpaceRouteFromHash(hash = location.hash) {
  const parts = String(hash || "").replace(/^#/, "").split("/");
  if (parts[0] !== "portfolio") return { category: "", sectionId: "", subsectionId: "", all: false };
  try {
    return { category: parts[1] || "", sectionId: decodeURIComponent(parts[2] || ""),
      subsectionId: parts[3] === "~all" ? "" : decodeURIComponent(parts[3] || ""), all: parts[3] === "~all" || parts[4] === "~all" };
  } catch { return { category: "", sectionId: "", subsectionId: "", all: false }; }
}
let personalSpaceRoute = personalSpaceRouteFromHash();
let personalSpaceRenderId = 0;
let personalSpaceObserver = null;
let personalSpaceRequests = null;
let personalSpaceClickTimer = 0;
let personalSpacePermissionLoad = 0;
let personalSpacePermissionsPending = false;
let personalSpaceRefreshError = "";

function personalSpaceHash(route = personalSpaceRoute) {
  const parts = ["portfolio"];
  if (route.category) parts.push(route.category);
  if (route.sectionId) parts.push(encodeURIComponent(route.sectionId));
  if (route.sectionId && route.subsectionId) parts.push(encodeURIComponent(route.subsectionId));
  if (route.sectionId && route.all) parts.push("~all");
  return parts.join("/");
}
function personalSpaceMotionReduced() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

// Reuse the global button feedback and navigate halfway through its actual
// rebound duration, without waiting for an entrance or bootstrap response.
function personalSpaceActivate(button, action, delay) {
  if (button?.disabled) return;
  clearTimeout(personalSpaceClickTimer);
  const duration = button && typeof getComputedStyle === "function"
    ? getComputedStyle(button).getPropertyValue("--xyj-motion-rebound").trim() : "";
  const match = duration.match(/^([\d.]+)(ms|s)$/);
  const reboundMs = match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : 940;
  personalSpaceClickTimer = setTimeout(action, personalSpaceMotionReduced() ? 0 : delay ?? reboundMs / 2);
}
function stopPersonalSpaceContent() {
  personalSpaceRenderId += 1;
  personalSpaceObserver?.disconnect(); personalSpaceObserver = null;
  personalSpaceRequests?.abort(); personalSpaceRequests = null;
}
function personalSpaceNavigate(next, { historyMode = "push", focus = true, preserveFolder = false } = {}) {
  stopPersonalSpaceContent();
  personalSpaceRoute = { category: "", sectionId: "", subsectionId: "", all: false, ...next };
  activePortfolioCategory = personalSpaceRoute.category || "content";
  state.activePortfolioSection = personalSpaceRoute.sectionId || null;
  if (!preserveFolder) state.currentResourceFolder = "";
  const keep = subsectionGrantPath(personalSpaceRoute.sectionId, personalSpaceRoute.subsectionId);
  if (preserveFolder) {
    let folder = (state.data?.assetFolders || []).find(item => item.id === state.currentResourceFolder);
    while (folder && !keep.has(`assetFolder:${folder.id}`)) {
      keep.add(`assetFolder:${folder.id}`);
      folder = (state.data?.assetFolders || []).find(item => item.id === folder.parent_id);
    }
  }
  // Remove grants from memory immediately. If any were removed, discard the
  // old unlocked bootstrap before drawing; server revocation runs in parallel.
  const removed = [...contentViewGrants.values()].some(grant => !keep.has(`${grant.kind}:${grant.id}`));
  const releasing = releaseViewGrants(grant => !keep.has(`${grant.kind}:${grant.id}`));
  if (removed) { personalSpacePermissionsPending = true; personalSpaceRefreshError = ""; }
  renderPersonalSpace({ entrance: false, hideContent: removed });
  if (historyMode !== "none") updateSectionHistory("portfolio", historyMode);
  document.getElementById("portfolio").scrollTop = 0;
  if (focus) document.getElementById("personal-space-title")?.focus({ preventScroll: true });
  const permissionLoad = removed ? ++personalSpacePermissionLoad : personalSpacePermissionLoad;
  if (removed) releasing.then(() => reloadPersonalSpacePermissions(permissionLoad));
}
function reloadPersonalSpacePermissions(permissionLoad = personalSpacePermissionLoad) {
  personalSpaceRefreshError = "";
  return api("/api/bootstrap").then(data => {
    if (permissionLoad !== personalSpacePermissionLoad) return;
    state.data = data; state.bootstrapPromise = null; personalSpacePermissionsPending = false; renderPersonalSpace();
  }).catch(error => {
    if (permissionLoad !== personalSpacePermissionLoad) return;
    personalSpaceRefreshError = error.message; renderPersonalSpace();
  });
}
function personalSpaceRestoreLocation() {
  personalSpaceNavigate(personalSpaceRouteFromHash(), { historyMode: "none" });
}
function personalSpaceLayout(section, current, field, fallback) {
  const subsections = state.data?.subsections || [];
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current[field] && current[field] !== "inherit") return current[field];
    current = subsections.find(item => item.id === current.parent_id && item.section_id === section.id);
  }
  return section[field] || fallback;
}
function personalSpaceEntry(label, next, small = false) {
  const button = document.createElement("button"); button.type = "button";
  button.className = `ps-entry${small ? " ps-entry-small" : ""}`;
  const name = document.createElement("strong"); name.textContent = label;
  const arrow = document.createElement("span"); arrow.className = "ps-entry-arrow"; arrow.textContent = "↗"; arrow.setAttribute("aria-hidden", "true");
  button.append(name, arrow);
  button.addEventListener("click", () => personalSpaceActivate(button, () => personalSpaceNavigate(next)));
  return button;
}
function personalSpaceRow(host, item, next, small = false) {
  const row = document.createElement("div"); row.className = `ps-section-row${small ? " ps-section-row-small" : ""}`;
  const button = personalSpaceEntry(`${item.name}${item.locked ? " · 已锁定" : ""}`, next, small);
  const description = document.createElement("div"); description.className = "ps-description";
  const text = document.createElement("p"); text.textContent = item.description || "点击左侧查看板块内容。";
  description.append(text); row.append(button, description); host.append(row);
}
function personalSpaceBreadcrumbs(tabs, section, current) {
  tabs.replaceChildren(); tabs.className = "ps-breadcrumbs"; tabs.removeAttribute("role");
  tabs.setAttribute("aria-label", "个人空间层级导航");
  const add = (label, route, last = false) => {
    if (tabs.childElementCount) { const slash = document.createElement("span"); slash.textContent = "/"; slash.setAttribute("aria-hidden", "true"); tabs.append(slash); }
    if (last) { const node = document.createElement("span"); node.textContent = label; node.setAttribute("aria-current", "page"); tabs.append(node); return; }
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => personalSpaceActivate(button, () => personalSpaceNavigate(route))); tabs.append(button);
  };
  const route = personalSpaceRoute;
  add("个人空间", {}, !route.category);
  if (!route.category) return;
  add(categoryLabels[route.category], { category: route.category }, !section);
  if (!section) return;
  add(section.name, { category: route.category, sectionId: section.id }, !current && !route.all);
  if (current?.parent_id) {
    const parent = state.data.subsections.find(item => item.id === current.parent_id);
    if (parent) add(parent.name, { category: route.category, sectionId: section.id, subsectionId: parent.id });
  }
  if (current) add(current.name, { ...route, all: false }, !route.all);
  if (route.all) add(current ? "本板块内容" : "全部内容", route, true);
}
function playPersonalSpaceEntrance() {
  if (personalSpaceRoute.category || personalSpaceMotionReduced()) return;
  const page = document.getElementById("portfolio");
  const title = document.getElementById("personal-space-title");
  if (!title || !page.classList.contains("active")) return;
  page.classList.remove("ps-entering");
  const box = page.getBoundingClientRect(); const rect = title.getBoundingClientRect();
  title.style.setProperty("--ps-title-x", `${box.left + box.width / 2 - rect.left - rect.width / 2}px`);
  title.style.setProperty("--ps-title-y", `${Math.min(box.height * .19, 145) - (rect.top - box.top)}px`);
  void title.offsetWidth; page.classList.add("ps-entering");
}
function renderPersonalSpace({ entrance = false, hideContent = false } = {}) {
  stopPersonalSpaceContent();
  const page = document.getElementById("portfolio");
  const host = document.getElementById("portfolio-panel-host");
  const tabs = document.getElementById("portfolio-tabs");
  const title = document.getElementById("personal-space-title");
  state.resourcePanelNode ||= document.querySelector("#resources .section-inner");
  host.replaceChildren(); page.classList.remove("ps-entering");
  let route = personalSpaceRoute;
  if (!Object.hasOwn(categoryLabels, route.category)) route = personalSpaceRoute = { category: "", sectionId: "", subsectionId: "", all: false };
  activePortfolioCategory = route.category || "content";
  const sections = organizedSections();
  const section = sections.find(item => item.id === route.sectionId);
  if (route.sectionId && !section) route = personalSpaceRoute = { category: route.category, sectionId: "", subsectionId: "", all: false };
  const subsections = (state.data?.subsections || []).filter(item => item.section_id === section?.id);
  let current = subsections.find(item => item.id === route.subsectionId);
  if (route.subsectionId && !current) { route.subsectionId = ""; route.all = false; }
  state.activePortfolioSection = section?.id || null;
  state.activeSubsections ||= {};
  if (section) state.activeSubsections[section.id] = route.all ? "all" : current?.id || "all";
  personalSpaceBreadcrumbs(tabs, section, current);
  title.textContent = current?.name || section?.name || categoryLabels[route.category] || "个人空间";
  title.classList.toggle("ps-title-root", !route.category);
  page.dataset.psLevel = !route.category ? "1" : !section ? "2" : current ? "4" : "3";
  if (!route.category) {
    tabs.hidden = true; host.className = "ps-landing";
    ["content", "gallery", "resources"].forEach((category, index) => {
      const button = personalSpaceEntry(categoryLabels[category], { category });
      button.style.setProperty("--ps-order", index); host.append(button);
    });
    if (entrance) playPersonalSpaceEntrance();
    return;
  }
  tabs.hidden = false; host.className = "ps-page";
  if (!section) {
    sections.forEach(item => personalSpaceRow(host, item, { category: route.category, sectionId: item.id }));
    if (!sections.length) host.append(empty("这个分类还没有可查看的板块。"));
    return;
  }
  if (hideContent || personalSpacePermissionsPending) {
    host.append(empty(personalSpaceRefreshError || "正在更新内容权限…"));
    if (personalSpaceRefreshError) {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn small ghost"; retry.textContent = "重新读取";
      retry.addEventListener("click", () => { retry.disabled = true; reloadPersonalSpacePermissions(); }); host.append(retry);
    }
    return;
  }
  const lockedParent = subsectionAncestorsForSpace(section.id, current).find(item => item.locked);
  if (section.locked || lockedParent) { lockedContentNotice(host, section.locked ? "section" : "subsection", section.locked ? section : lockedParent); return; }
  const children = subsections.filter(item => (item.parent_id || "") === (current?.id || ""));
  if (children.length && !route.all) {
    page.dataset.psLevel = current ? "3" : "2";
    // Existing articles saved directly in the parent remain reachable, as do
    // the Studio '全部' setting and the mixed legacy sections.
    if (Number(section.show_all) !== 0 || current || personalSpaceHasDirectContent(section.id)) {
      personalSpaceRow(host, { name: current ? "本板块内容" : "全部内容", description: current ? "查看这个板块及其下属板块的内容。" : "按发布时间浏览本大板块中的全部内容。" },
        { ...route, all: true }, Boolean(current));
    }
    children.forEach(item => personalSpaceRow(host, item, { category: route.category, sectionId: section.id, subsectionId: item.id }, Boolean(current)));
    return;
  }
  page.dataset.psLevel = "4";
  if (current?.description || section.description) {
    const note = document.createElement("p"); note.className = "ps-content-description"; note.textContent = current?.description || section.description; host.append(note);
  }
  const selected = route.all && !current ? "all" : current?.id || "all";
  if (route.category === "resources") {
    if (state.resourcePanelNode) host.append(state.resourcePanelNode);
    renderOrganizedResources(selected); return;
  }
  if (route.category === "gallery") { renderPersonalSpaceGallery(host, section, current, selected); return; }
  const items = (state.data?.content || []).filter(item => item.section_id === section.id && subsectionMatches(item.subsection_id, selected));
  items.sort((a, b) => (Date.parse(b.published_at || b.created_at) || 0) - (Date.parse(a.published_at || a.created_at) || 0) || String(a.id).localeCompare(String(b.id)));
  if (personalSpaceLayout(section, current, "article_layout", "article") === "feed") renderPersonalSpaceFeed(host, items);
  else {
    const grid = document.createElement("div"); grid.className = "content-grid ps-article-list";
    items.forEach(item => grid.append(contentCard(item, section))); host.append(grid);
  }
  if (!items.length) host.append(empty("这个板块还没有可查看的文章。"));
}
function subsectionAncestorsForSpace(sectionId, current) {
  const result = []; const seen = new Set();
  while (current && !seen.has(current.id)) {
    result.unshift(current); seen.add(current.id);
    current = (state.data?.subsections || []).find(item => item.id === current.parent_id && item.section_id === sectionId);
  }
  return result;
}
function personalSpaceHasDirectContent(sectionId) {
  const items = activePortfolioCategory === "content" ? state.data?.content : activePortfolioCategory === "gallery" ? state.data?.media : organizedAssets();
  return (items || []).some(item => item.section_id === sectionId && !item.subsection_id);
}
function renderPersonalSpaceGallery(host, section, current, selected) {
  const photos = (state.data?.media || []).filter(item => item.section_id === section.id && subsectionMatches(item.subsection_id, selected));
  const gallery = document.createElement("div");
  gallery.className = `gallery ps-gallery ps-gallery-${personalSpaceLayout(section, current, "gallery_layout", "grid")}`;
  photos.forEach(photo => {
    const card = document.createElement("div"); card.className = `photo-card${photo.locked ? " is-locked" : ""}`; card.tabIndex = 0; card.setAttribute("role", "button");
    card.setAttribute("aria-label", photo.locked ? "解锁照片" : `查看照片：${photo.caption || photo.filename}`);
    const image = document.createElement("img"); image.loading = "lazy"; image.decoding = "async"; image.src = protectedMediaUrl(photo.previewUrl || photo.url); image.alt = photo.caption || "照片";
    const name = document.createElement("span"); name.className = "photo-name"; name.textContent = `${photo.caption || photo.filename}${photo.note ? ` · ${photo.note}` : ""}${photo.locked ? " · 已锁定" : ""}`;
    card.append(image, name);
    const open = () => {
      if (typeof warmImagePreview === "function") warmImagePreview(photo);
      personalSpaceActivate(card, () => openImage(photo, photos));
    };
    card.addEventListener("click", open); card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }); gallery.append(card);
  });
  if (!photos.length) gallery.append(empty("这个板块还没有可查看的照片。")); host.append(gallery);
}
function personalSpaceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未标注";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date);
}
function renderPersonalSpaceFeed(host, items) {
  const generation = personalSpaceRenderId;
  const controller = personalSpaceRequests = new AbortController();
  const feed = document.createElement("div"); feed.className = "ps-feed";
  const jobs = new Map(); const queue = []; let running = 0;
  const pump = () => {
    while (running < 2 && queue.length && !controller.signal.aborted) {
      const job = queue.shift(); running += 1;
      api(`/api/content/${encodeURIComponent(job.item.id)}`, { signal: controller.signal }).then(content => {
        if (generation !== personalSpaceRenderId || !job.body.isConnected) return;
        renderReaderBody(content.body_html, { root: job.body, content });
      }).catch(error => {
        if (controller.signal.aborted || generation !== personalSpaceRenderId || !job.body.isConnected) return;
        job.body.replaceChildren(empty(error.message || "正文读取失败。"));
        const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn small ghost"; retry.textContent = "重新读取";
        retry.addEventListener("click", () => { retry.remove(); queue.push(job); pump(); }); job.body.append(retry);
      }).finally(() => { running -= 1; pump(); });
    }
  };
  if (typeof IntersectionObserver === "function") personalSpaceObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (!entry.isIntersecting) return; const job = jobs.get(entry.target); if (job) { jobs.delete(entry.target); queue.push(job); personalSpaceObserver?.unobserve(entry.target); } }); pump();
  }, { root: document.getElementById("portfolio"), rootMargin: "240px" });
  items.forEach(item => {
    const card = document.createElement("article"); card.className = "ps-feed-entry"; card.dataset.contentId = item.id;
    const date = document.createElement("time"); date.className = "ps-feed-date"; date.dateTime = item.published_at || item.created_at || ""; date.textContent = personalSpaceDate(date.dateTime);
    const title = document.createElement("h2"); title.textContent = item.title;
    const body = document.createElement("div"); body.className = "reader-body ps-feed-body";
    body.addEventListener("click", event => { const link = event.target.closest?.("a[data-article-url]"); if (link) { event.preventDefault(); showArticleLinkConfirmation(link.dataset.articleUrl); } });
    const actions = document.createElement("div"); actions.className = "ps-feed-actions";
    const read = document.createElement("button"); read.type = "button"; read.className = "btn small ghost"; read.textContent = "阅读全文与评论";
    read.addEventListener("click", () => personalSpaceActivate(read, () => openContent(item.id))); actions.append(read);
    card.append(date, document.createElement("hr"), title, body, actions); feed.append(card);
    if (item.locked) lockedContentNotice(body, "content", item);
    else { body.append(empty("正在读取正文…")); jobs.set(card, { item, body }); }
  });
  host.append(feed);
  jobs.forEach((job, card) => { if (personalSpaceObserver) personalSpaceObserver.observe(card); else queue.push(job); });
  if (!personalSpaceObserver) pump();
}
