/** D1 原子计数限流，用于登录、写操作和模型请求。 */
import { HttpError } from "../http/responses.js";
import { sha256 } from "./crypto.js";

export async function consumeRateLimit(env, key, maxCount, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  /*
   * 检查与累加必须在同一条 SQLite 语句里完成，否则并发请求会同时读到旧值，
   * 从而越过登录、AI 或写操作的限制。计数封顶在 max + 1，避免攻击流量无限增大字段。
   */
  const state = await env.DB.prepare(`
    INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.reset_at <= ? THEN 1
        ELSE MIN(rate_limits.count + 1, ?)
      END,
      reset_at = CASE
        WHEN rate_limits.reset_at <= ? THEN excluded.reset_at
        ELSE rate_limits.reset_at
      END
    RETURNING count, reset_at
  `).bind(key, now + windowSeconds, now, maxCount + 1, now).first();
  if (Number(state?.count || 0) > maxCount) {
    throw new HttpError(429, "操作过于频繁，请稍后再试");
  }
}

export async function clientRateKey(request, scope) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return `${scope}:${await sha256(ip)}`;
}
