/* ---------- 游客按日统计与 Turnstile 配置状态 ---------- */
async function loadGuestAnalytics() {
  const days = document.getElementById("visitor-days").value || "30";
  const day = document.getElementById("visitor-day").value;
  const query = new URLSearchParams({ days });
  if (day) query.set("day", day);
  app.guestAnalytics = await api(`/api/admin/guest-analytics?${query}`);
  renderGuestAnalytics();
}

function renderGuestAnalytics() {
  const data = app.guestAnalytics;
  if (!data) return;
  const status = document.getElementById("visitor-analytics-status");
  const missingTurnstileKeys = [
    data.turnstile?.missingSiteKey ? "TURNSTILE_SITE_KEY" : "",
    data.turnstile?.missingSecretKey ? "TURNSTILE_SECRET_KEY" : ""
  ]
    .filter(Boolean)
    .join("、");
  const protection = data.turnstile?.configured
    ? "Turnstile 已启用，游客必须通过服务端验证"
    : data.turnstile?.incomplete
      ? `Turnstile 配置不完整：缺少 ${missingTurnstileKeys || "Site Key 或 Secret Key"}；当前临时使用 IP 频率限制`
      : "Turnstile 尚未配置，目前仅启用 IP 频率限制";
  status.textContent = `${protection}。统计时区：${data.timeZone}；明细自动保留 ${data.retentionDays} 天。IP 仅显示脱敏网段，位置来自 Cloudflare 的大致定位。`;

  const totals = (data.summary || []).reduce(
    (sum, item) => ({
      visitors: sum.visitors + item.unique_visitors,
      ips: sum.ips + item.unique_ips,
      entries: sum.entries + item.entries,
      views: sum.views + item.page_views
    }),
    { visitors: 0, ips: 0, entries: 0, views: 0 }
  );
  const cards = document.getElementById("visitor-total-cards");
  clear(cards);
  [
    ["日访客累计", totals.visitors],
    ["独立 IP 累计", totals.ips],
    ["进入次数", totals.entries],
    ["页面浏览", totals.views]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("strong");
    number.textContent = value;
    card.append(name, number);
    cards.append(card);
  });

  const daily = document.getElementById("visitor-day-list");
  clear(daily);
  if (!(data.summary || []).length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "所选范围内还没有游客记录。";
    daily.append(p);
  }
  (data.summary || []).forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "list-item";
    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = item.visit_day === data.today ? `${item.visit_day}（今天）` : item.visit_day;
    const meta = document.createElement("div");
    meta.className = "list-meta";
    meta.textContent = `访客 ${item.unique_visitors} · IP ${item.unique_ips} · 进入 ${item.entries} · 浏览 ${item.page_views}`;
    row.append(title, meta);
    row.addEventListener("click", () => {
      document.getElementById("visitor-day").value = item.visit_day;
      loadGuestAnalytics().catch((error) => alert(error.message));
    });
    daily.append(row);
  });

  const details = document.getElementById("visitor-detail-list");
  clear(details);
  if (!(data.visitors || []).length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "没有符合条件的游客明细。";
    details.append(p);
  }
  (data.visitors || []).forEach((item) => {
    const row = document.createElement("article");
    row.className = "list-item";
    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = `访客 ${item.visitor_id} · ${item.ip_hint || "IP 未知"}`;
    const location = [item.country, item.region, item.city].filter(Boolean).join(" / ") || "地区未知";
    const meta = document.createElement("div");
    meta.className = "list-meta";
    meta.textContent = `${item.visit_day} · ${location} · 首次 ${formatDate(item.first_seen_at)} · 最近 ${formatDate(item.last_seen_at)}`;
    const activity = document.createElement("div");
    activity.className = "list-meta";
    activity.textContent = `进入 ${item.entry_count} 次 · 浏览 ${item.page_views} 页 · 最后板块 ${item.last_section || "未知"}`;
    const network = document.createElement("div");
    network.className = "list-meta";
    network.textContent = `${item.asn ? `ASN ${item.asn}` : "ASN 未知"}${item.as_organization ? ` · ${item.as_organization}` : ""}${item.timezone ? ` · ${item.timezone}` : ""}${item.referrer ? ` · 来源 ${item.referrer}` : ""}`;
    const agent = document.createElement("div");
    agent.className = "list-meta";
    agent.textContent = `设备/浏览器：${item.user_agent || "未知"}`;
    row.append(title, meta, activity, network, agent);
    details.append(row);
  });
}
