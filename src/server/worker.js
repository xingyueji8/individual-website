/** Worker 的公开入口：只决定请求去 API、媒体服务还是静态页面。 */
import { guestSessionCookie } from "./accounts/guest-session.js";
import { requireMediaVisitor } from "./accounts/website-access.js";
import { ensureSchema } from "./db/initialize.js";
import { handleApi } from "./http/api.js";
import { requestGateResponse } from "./http/request.js";
import { APP_VERSION, HttpError, json, responseWithSecurityHeaders, SECURITY_HEADERS } from "./http/responses.js";
import { serveAsset } from "./media/file-response.js";
import { serveMedia } from "./media/image-response.js";
import { shareVisitorCookie } from "./shared/request-meta.js";
import { validId } from "./shared/values.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const gateResponse = requestGateResponse(url, env);
      if (gateResponse) return gateResponse;
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: SECURITY_HEADERS });
      }
      if (/^\/share\/[a-f0-9]{64}\/?$/.test(url.pathname)) {
        const response = responseWithSecurityHeaders(await env.ASSETS.fetch(new Request(new URL("/share", url), request)));
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("Referrer-Policy", "no-referrer");
        headers.append("Set-Cookie", shareVisitorCookie());
        headers.append("Set-Cookie", guestSessionCookie(request, "", 0));
        return new Response(response.body, { status: response.status, headers });
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url, ctx);
      if (url.pathname.startsWith("/media/")) {
        if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "不支持的请求方法");
        await ensureSchema(env);
        if (url.searchParams.get("background") !== "1") await requireMediaVisitor(request, env);
        const id = url.pathname.split("/").filter(Boolean)[1];
        if (!validId(id)) throw new HttpError(404, "图片不存在");
        return await serveMedia(request, env, id);
      }
      if (url.pathname.startsWith("/files/")) {
        await ensureSchema(env);
        await requireMediaVisitor(request, env);
        const id = url.pathname.split("/").filter(Boolean)[1];
        if (!validId(id)) throw new HttpError(404, "文件不存在");
        return await serveAsset(request, env, id);
      }
      const response = responseWithSecurityHeaders(await env.ASSETS.fetch(request));
      if (["/document-viewer", "/document-viewer/", "/document-viewer.html"].includes(url.pathname)) {
        response.headers.set("X-Frame-Options", "SAMEORIGIN");
        response.headers.set("Referrer-Policy", "no-referrer");
        response.headers.set("Content-Security-Policy", "base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; img-src 'self' data:");
      }
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, ...(error.code ? { errorCode: error.code } : {}) }, error.status);
      }
      console.error("Unhandled worker error", error);
      return json({ error: "服务器处理请求时发生错误", errorCode: "WORKER_UNHANDLED", version: APP_VERSION }, 500);
    }
  },
};
