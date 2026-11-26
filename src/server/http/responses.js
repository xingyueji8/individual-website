/** 统一生成 HTTP 响应、安全响应头和接口错误。 */

export const APP_VERSION = "2.3.0.0";

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  // 先使用一天的观察期，确认 HTTPS 全链路稳定后可在 Cloudflare 中逐步延长。
  "Strict-Transport-Security": "max-age=86400",
};

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "X-Xingyueji-Version": APP_VERSION,
      ...headers,
    },
  });
}

/*
 * Headers 对同名 Set-Cookie 的追加语义比普通对象可靠。登录成功时需要同时
 * 写入账户会话并清除游客会话，避免浏览器里两种身份并存后公开接口误用高
 * 权限身份。其余普通 JSON 响应仍继续使用上面的轻量 helper。
 */
export function jsonWithCookies(data, status, cookies, headers = {}) {
  const responseHeaders = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Xingyueji-Version": APP_VERSION,
    ...headers,
  });
  for (const cookie of cookies) {
    if (cookie) responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function textResponse(message, status = 200, headers = {}) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function responseWithSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (!headers.has(name)) headers.set(name, value);
  });
  if (!headers.has("X-Xingyueji-Version")) headers.set("X-Xingyueji-Version", APP_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class HttpError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
