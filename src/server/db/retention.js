/** 首次启动时清理到期的访问统计、会话和派生数据。 */
import { GUEST_ANALYTICS_RETENTION_DAYS, QQ_WEBHOOK_REPLAY_TTL_SECONDS } from "../shared/config.js";
import { analyticsDay, nowIso } from "../shared/values.js";

export async function cleanupHistoricalRecords(env) {
  /*
   * 登录痕迹只保留最近 90 天；过期会话和过期重置申请同时做状态清理。
   * 旧版远程翻译缓存可能包含动态页面文字，停用远程翻译后立即清空。
   * 这些语句只清理过期安全记录和派生缓存，不会影响用户账号或站内内容。
   */
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_events WHERE created_at < ?")
      .bind(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()),
    env.DB.prepare("DELETE FROM guest_visits WHERE visit_day < ?")
      .bind(analyticsDay(env, new Date(Date.now() - GUEST_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000))),
    env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < ?")
      .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?")
      .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    env.DB.prepare("DELETE FROM qq_webhook_events WHERE received_at < ?")
      .bind(new Date(Date.now() - QQ_WEBHOOK_REPLAY_TTL_SECONDS * 1000).toISOString()),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?")
      .bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60),
    env.DB.prepare("DELETE FROM translations"),
    env.DB.prepare(`
      UPDATE password_reset_requests SET status = 'expired'
      WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= ?
    `).bind(nowIso()),
  ]);
}
