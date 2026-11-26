/** Studio 仪表盘与游客数据汇总。 */
import { turnstileStatus } from "../accounts/turnstile.js";
import { HttpError } from "../http/responses.js";
import { GUEST_ANALYTICS_RETENTION_DAYS } from "../shared/config.js";
import { analyticsDay, clampText, nowIso, rows } from "../shared/values.js";

export async function adminGuestAnalytics(request, env, url) {
  if (request.method !== "GET") throw new HttpError(405, "不支持的请求方法");
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get("days") || "30", 10) || 30));
  const requestedDay = clampText(url.searchParams.get("day"), 10);
  if (requestedDay && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDay)) {
    throw new HttpError(400, "统计日期格式错误");
  }
  const fromDay = analyticsDay(env, new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
  const [summary, visitors] = await Promise.all([
    env.DB.prepare(`
      SELECT visit_day,
             COUNT(*) AS unique_visitors,
             COUNT(DISTINCT ip_hash) AS unique_ips,
             COALESCE(SUM(entry_count), 0) AS entries,
             COALESCE(SUM(page_views), 0) AS page_views
      FROM guest_visits
      WHERE visit_day >= ?
      GROUP BY visit_day
      ORDER BY visit_day DESC
    `).bind(fromDay).all(),
    requestedDay
      ? env.DB.prepare(`
          SELECT visit_day, substr(visitor_hash, 1, 12) AS visitor_id, ip_hint, country,
                 region, city, timezone, asn, as_organization, user_agent, referrer,
                 entry_count, page_views, last_section, first_seen_at, last_seen_at
          FROM guest_visits
          WHERE visit_day = ?
          ORDER BY last_seen_at DESC
          LIMIT 500
        `).bind(requestedDay).all()
      : env.DB.prepare(`
          SELECT visit_day, substr(visitor_hash, 1, 12) AS visitor_id, ip_hint, country,
                 region, city, timezone, asn, as_organization, user_agent, referrer,
                 entry_count, page_views, last_section, first_seen_at, last_seen_at
          FROM guest_visits
          WHERE visit_day >= ?
          ORDER BY last_seen_at DESC
          LIMIT 300
        `).bind(fromDay).all(),
  ]);
  const protection = turnstileStatus(env);
  return {
    today: analyticsDay(env),
    timeZone: clampText(env.ANALYTICS_TIMEZONE || "Asia/Shanghai", 80),
    retentionDays: GUEST_ANALYTICS_RETENTION_DAYS,
    turnstile: {
      configured: protection.configured,
      incomplete: protection.incomplete,
      missingSiteKey: protection.missingSiteKey,
      missingSecretKey: protection.missingSecretKey,
    },
    summary: rows(summary).map((item) => ({
      ...item,
      unique_visitors: Number(item.unique_visitors || 0),
      unique_ips: Number(item.unique_ips || 0),
      entries: Number(item.entries || 0),
      page_views: Number(item.page_views || 0),
    })),
    visitors: rows(visitors).map((item) => ({
      ...item,
      asn: Number(item.asn || 0),
      entry_count: Number(item.entry_count || 0),
      page_views: Number(item.page_views || 0),
    })),
  };
}

export async function adminDashboard(env) {
  const today = analyticsDay(env);
  const [content, published, comments, media, assets, logs, sections, feedback, unreadFeedback, users, pendingUsers, onlineUsers, resetRequests, guestVisitors, guestPageViews] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM content").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM content WHERE status = 'published'").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM comments").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM media").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE status = 'ready'").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM changelogs").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM portfolio_sections").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM feedback").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status = 'new'").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'pending'").first(),
    env.DB.prepare(`
      SELECT COUNT(DISTINCT user_id) AS count FROM user_sessions
      WHERE revoked_at IS NULL AND expires_at > ? AND last_seen_at > ?
    `).bind(nowIso(), new Date(Date.now() - 2 * 60 * 1000).toISOString()).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM password_reset_requests WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COALESCE(SUM(entry_count), 0) AS count FROM guest_visits WHERE visit_day = ?").bind(today).first(),
    env.DB.prepare("SELECT COALESCE(SUM(page_views), 0) AS count FROM guest_visits WHERE visit_day = ?").bind(today).first(),
  ]);
  return {
    content: Number(content?.count || 0),
    published: Number(published?.count || 0),
    comments: Number(comments?.count || 0),
    media: Number(media?.count || 0),
    assets: Number(assets?.count || 0),
    changelogs: Number(logs?.count || 0),
    sections: Number(sections?.count || 0),
    feedback: Number(feedback?.count || 0),
    unreadFeedback: Number(unreadFeedback?.count || 0),
    users: Number(users?.count || 0),
    pendingUsers: Number(pendingUsers?.count || 0),
    onlineUsers: Number(onlineUsers?.count || 0),
    resetRequests: Number(resetRequests?.count || 0),
    guestVisitorsToday: Number(guestVisitors?.count || 0),
    guestPageViewsToday: Number(guestPageViews?.count || 0),
  };
}
