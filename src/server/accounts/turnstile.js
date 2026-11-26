/** Cloudflare Turnstile 配置和服务端人机验证。 */
import { HttpError } from "../http/responses.js";
import { clampText } from "../shared/values.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_GUEST_ACTION = "guest_entry";

/* ============================================================
 * 游客验证、会话与按日访问统计
 * ============================================================
 * - TURNSTILE_SITE_KEY 是可公开的站点密钥；TURNSTILE_SECRET_KEY / SECRET
 *   只能保存在 Cloudflare Secret 中。
 * - D1 不保存完整 IP，只保存不可逆摘要和 203.0.113.* 形式的脱敏提示。
 * - visitor_hash 来自浏览器随机编号的 HMAC，只代表同一浏览器，不代表真实身份。
 */
export function turnstileStatus(env) {
  /*
   * 同时兼容此前文档使用的 TURNSTILE_* 与部分 Cloudflare 模板使用的
   * CF_TURNSTILE_* 名称，避免密钥已经填写却因变量名不同而被误判为缺失。
   */
  const siteKey = clampText(env.TURNSTILE_SITE_KEY || env.CF_TURNSTILE_SITE_KEY, 200);
  const secretKey = String(
    env.TURNSTILE_SECRET_KEY
    || env.TURNSTILE_SECRET
    || env.CF_TURNSTILE_SECRET_KEY
    || "",
  ).trim();
  const missingSiteKey = !siteKey;
  const missingSecretKey = !secretKey;
  return {
    configured: Boolean(siteKey && secretKey),
    incomplete: missingSiteKey !== missingSecretKey,
    missingSiteKey,
    missingSecretKey,
    siteKey,
    secretKey,
  };
}

export async function verifyGuestTurnstile(request, env, token) {
  const status = turnstileStatus(env);
  /*
   * 完全未配置或只配置了一项时，都退回 enterGuestWebsite() 上方的严格 IP
   * 限流。这样配置失误不会锁死整个游客入口；Studio 和登录页仍会明确提示
   * 缺少项，补齐两项后会自动恢复 Turnstile 服务端校验。
   */
  if (!status.configured) return { protected: false, degraded: status.incomplete };
  const responseToken = clampText(token, 2048);
  if (!responseToken) throw new HttpError(403, "请先完成人机验证");

  const form = new FormData();
  form.append("secret", status.secretKey);
  form.append("response", responseToken);
  form.append("remoteip", request.headers.get("CF-Connecting-IP") || "");
  form.append("idempotency_key", crypto.randomUUID());
  let result;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    result = await response.json();
  } catch (error) {
    console.error("Turnstile Siteverify failed", error);
    throw new HttpError(502, "人机验证服务暂时不可用，请稍后重试");
  }
  if (!result?.success || result.action !== TURNSTILE_GUEST_ACTION) {
    console.warn("Turnstile rejected guest entry", result?.["error-codes"] || []);
    throw new HttpError(403, "人机验证未通过或已经过期，请重新验证");
  }
  const configuredHostnames = String(env.TURNSTILE_HOSTNAMES || "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const expectedHostnames = configuredHostnames.length
    ? configuredHostnames
    : [new URL(request.url).hostname.toLowerCase()];
  if (!expectedHostnames.includes(String(result.hostname || "").toLowerCase())) {
    throw new HttpError(403, "人机验证来源不匹配");
  }
  return { protected: true };
}
