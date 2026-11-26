/** 游客进入与访问统计、会话心跳和运行时检查。 */
import {
  GUEST_SESSION_TTL_SECONDS,
  guestSessionCookie,
  guestVisitorHash,
  makeGuestSession,
  requireGuestSession,
} from "./guest-session.js";
import { recordLoginEvent, userSessionCookie } from "./member-session.js";
import { revokeAdminSession, secureCookie } from "./studio-session.js";
import { verifyGuestTurnstile } from "./turnstile.js";
import { requireWebsiteVisitor } from "./website-access.js";
import { readJson } from "../http/request.js";
import { APP_VERSION, HttpError, json, SECURITY_HEADERS } from "../http/responses.js";
import { clientRateKey, consumeRateLimit } from "../shared/rate-limits.js";
import { guestRequestMeta } from "../shared/request-meta.js";
import { analyticsDay, clampText, nowIso, validId } from "../shared/values.js";

async function recordGuestVisit(env, request, visitorHash, { entries = 0, pageViews = 1, section = "home" } = {}) {
  const meta = await guestRequestMeta(request);
  const timestamp = nowIso();
  const day = analyticsDay(env);
  const normalizedSection = validId(section) ? String(section) : "home";
  await env.DB.prepare(`
    INSERT INTO guest_visits
      (id, visit_day, visitor_hash, ip_hash, ip_hint, country, region, city, timezone,
       asn, as_organization, user_agent, referrer, entry_count, page_views, last_section,
       first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(visit_day, visitor_hash) DO UPDATE SET
      ip_hash = excluded.ip_hash,
      ip_hint = excluded.ip_hint,
      country = excluded.country,
      region = excluded.region,
      city = excluded.city,
      timezone = excluded.timezone,
      asn = excluded.asn,
      as_organization = excluded.as_organization,
      user_agent = excluded.user_agent,
      referrer = CASE WHEN guest_visits.referrer = '' THEN excluded.referrer ELSE guest_visits.referrer END,
      entry_count = guest_visits.entry_count + excluded.entry_count,
      page_views = guest_visits.page_views + excluded.page_views,
      last_section = excluded.last_section,
      last_seen_at = excluded.last_seen_at
  `).bind(
    crypto.randomUUID(), day, visitorHash, meta.ipHash, meta.ipHint,
    meta.country, meta.region, meta.city, meta.timezone, meta.asn, meta.asOrganization,
    meta.userAgent, meta.referrer, Math.max(0, Number(entries) || 0),
    Math.max(0, Number(pageViews) || 0), normalizedSection, timestamp, timestamp,
  ).run();
}

export async function enterGuestWebsite(request, env) {
  await consumeRateLimit(env, await clientRateKey(request, "guest-entry"), 12, 15 * 60);
  const body = await readJson(request);
  const visitorId = clampText(body.visitorId, 80);
  if (!validId(visitorId)) throw new HttpError(400, "游客浏览器编号无效，请刷新页面后重试");
  const verification = await verifyGuestTurnstile(request, env, body.turnstileToken);
  const visitorHash = await guestVisitorHash(env, visitorId);
  const day = analyticsDay(env);
  const [limitSetting, guestEntryCount] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key = 'guest_daily_limit'").first(),
    env.DB.prepare("SELECT COALESCE(SUM(entry_count), 0) AS count FROM guest_visits WHERE visit_day = ?")
      .bind(day).first(),
  ]);
  const dailyLimit = Math.max(0, Math.min(100000, Number.parseInt(limitSetting?.value || "20", 10) || 0));
  if (dailyLimit > 0 && Number(guestEntryCount?.count || 0) >= dailyLimit) {
    throw new HttpError(
      429,
      "本日游客浏览已达流量上限，请注册账号进行浏览",
      "GUEST_DAILY_LIMIT",
    );
  }
  await recordGuestVisit(env, request, visitorHash, { entries: 1, pageViews: 1, section: "home" });
  const session = await makeGuestSession(env, visitorHash);
  return json({ ok: true, protected: verification.protected }, 200, {
    "Set-Cookie": guestSessionCookie(request, session, GUEST_SESSION_TTL_SECONDS),
  });
}

export async function trackGuestWebsite(request, env) {
  const session = await requireGuestSession(request, env);
  await consumeRateLimit(env, `guest-track:${session.visitorHash}`, 180, 60 * 60);
  const body = await readJson(request);
  const section = clampText(body.section, 80) || "home";
  await recordGuestVisit(env, request, session.visitorHash, { entries: 0, pageViews: 1, section });
  return { ok: true };
}

/* ============================================================
 * 网站主体运行时反机器人复核
 * ============================================================
 * 入口 Turnstile 只能证明“进入网站的这一刻”通过了验证，不能覆盖进入后的
 * 自动化操作。主页因此每隔一段时间只上报行为数量，不上报按键内容、鼠标
 * 坐标或正在阅读的正文。Worker 仅对高置信度信号执行拦截，避免把安静阅读、
 * 长时间停留、触控板滚动以及辅助功能用户误判为机器人。
 */
function finiteBehaviorCount(value, maximum = 100_000) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count)) return 0;
  return Math.min(maximum, Math.max(0, count));
}

async function runtimeSecurityIdentity(request, env) {
  const identity = await requireWebsiteVisitor(request, env);
  if (identity.type === "guest") return { ...identity, rateKey: `runtime-guest:${identity.visitorHash}` };
  if (identity.type === "user") return { ...identity, rateKey: `runtime-user:${identity.user.id}` };
  return { ...identity, rateKey: await clientRateKey(request, "runtime-admin") };
}

async function runtimeBotBlockedResponse(request, env, identity, reasons) {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Xingyueji-Version": APP_VERSION,
  });

  /*
   * 只撤销当前用于浏览网站的身份，不牵连同一网络中的其他正常用户。
   * 普通账号的随机会话同时在 D1 中标记为撤销，不能只靠删除浏览器 Cookie。
   */
  if (identity.type === "guest") {
    headers.append("Set-Cookie", guestSessionCookie(request, "", 0));
  } else if (identity.type === "user") {
    await env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(nowIso(), identity.user.token_hash).run();
    await recordLoginEvent(env, request, "runtime_bot_blocked", identity.user.id, identity.user.username_normalized)
      .catch((error) => console.error("Runtime bot event logging failed", error));
    headers.append("Set-Cookie", userSessionCookie(request, "", 0));
  } else {
    await revokeAdminSession(request, env);
    headers.append("Set-Cookie", secureCookie(request, "", 0));
  }

  console.warn("Runtime bot protection terminated a website session", {
    identityType: identity.type,
    reasons,
  });
  return new Response(JSON.stringify({
    error: "检测到异常自动化行为，当前访问已被终止。",
    errorCode: "BOT_DETECTED",
    closePage: true,
  }), { status: 403, headers });
}

export async function runtimeSecurityHeartbeat(request, env) {
  const identity = await runtimeSecurityIdentity(request, env);
  /* 正常页面 45 秒一次；20 次/5 分钟为多标签页和网络重试保留充足余量。 */
  await consumeRateLimit(env, identity.rateKey, 20, 5 * 60);
  const body = await readJson(request);
  const elapsedMs = finiteBehaviorCount(body.elapsedMs, 10 * 60 * 1000);
  const clicks = finiteBehaviorCount(body.clicks);
  const keydowns = finiteBehaviorCount(body.keydowns);
  const scrolls = finiteBehaviorCount(body.scrolls);
  const navigations = finiteBehaviorCount(body.navigations);
  const untrustedActions = finiteBehaviorCount(body.untrustedActions);
  const maxClickBurst = finiteBehaviorCount(body.maxClickBurst, 10_000);
  const reasons = [];

  /*
   * 阈值刻意设置得远高于真人快速操作范围。单纯“没有鼠标移动”或“长时间
   * 没有操作”绝不构成异常；那两种情况通常只是正在阅读文章或使用键盘。
   */
  if (body.webdriver === true) reasons.push("webdriver");
  if (untrustedActions >= 4) reasons.push("repeated-untrusted-events");
  if (maxClickBurst >= 16) reasons.push("impossible-click-burst");
  if (elapsedMs > 0 && elapsedMs <= 60_000 && clicks >= 160) reasons.push("excessive-click-rate");
  if (elapsedMs > 0 && elapsedMs <= 60_000 && keydowns >= 900) reasons.push("excessive-key-rate");
  if (elapsedMs > 0 && elapsedMs <= 60_000 && navigations >= 90) reasons.push("excessive-navigation-rate");
  if (elapsedMs > 0 && elapsedMs <= 60_000 && scrolls >= 2_400) reasons.push("excessive-scroll-rate");

  if (reasons.length) return runtimeBotBlockedResponse(request, env, identity, reasons);
  return json({ ok: true, nextCheckSeconds: 45 }, 200, { "Cache-Control": "no-store" });
}
