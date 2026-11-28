/** 公开 API 和用户接口路由；业务实现由对应功能文件负责。 */
import { authorizeAndroidLogin, redeemAndroidLogin } from "../accounts/android-login.js";
import { enterGuestWebsite, runtimeSecurityHeartbeat, trackGuestWebsite } from "../accounts/guest-activity.js";
import {
  authSession,
  changeUserPassword,
  loginUser,
  logoutUser,
  registerUser,
  updateUserProfile,
} from "../accounts/member-auth.js";
import { requireApprovedUser } from "../accounts/member-session.js";
import { passwordResetInfo, requestPasswordReset, resetUserPassword } from "../accounts/password-reset.js";
import { adminLogin, isAdmin } from "../accounts/studio-session.js";
import { TURNSTILE_GUEST_ACTION, turnstileStatus } from "../accounts/turnstile.js";
import { requireShareNavigationLogin, requireWebsiteVisitor } from "../accounts/website-access.js";
import { createComment, listPublicComments } from "../community/comments.js";
import { createFeedback, listPublicFeedback } from "../community/feedback.js";
import { privateMessages } from "../community/messages.js";
import { notificationInbox, notificationPreferences, updateNotification } from "../community/notifications.js";
import { react } from "../community/reactions.js";
import { getPublicContent } from "../content/articles.js";
import { publicEntryBackground } from "../content/backgrounds.js";
import { publicBootstrap } from "../content/catalog.js";
import { SECURITY_TABLES } from "../content/permission-graph.js";
import { contentSecurity, releaseContentGrants, unlockContent } from "../content/permissions.js";
import { shareHooks } from "../content/share-api.js";
import { resolveShare, sharedContent, shareListing } from "../content/share-links.js";
import { ensureSchema } from "../db/initialize.js";
import { readJson, rejectCrossSiteMutation } from "./request.js";
import { APP_VERSION, HttpError, json } from "./responses.js";
import { handleAdmin } from "./studio-api.js";
import { consumeAgentAction, ensureAgentActions } from "../integrations/agent-actions.js";
import { askAi, askAiStream, runSiteAgent } from "../integrations/ai.js";
import { notifyFeedback } from "../integrations/outbound-notices.js";
import { getQqTargetOpenid, handleQqWebhook } from "../integrations/qq.js";
import { serveAsset } from "../media/file-response.js";
import { serveMedia } from "../media/image-response.js";
import { GUEST_ANALYTICS_RETENTION_DAYS } from "../shared/config.js";
import { sha256 } from "../shared/crypto.js";
import { validId } from "../shared/values.js";

export async function handleApi(request, env, url, ctx) {
  /*
   * QQ 开放平台的回调验证必须在普通 API 的 D1 初始化之前响应，否则数据库
   * 临时故障会导致平台误判回调地址不可用。GET 仅用于站长在浏览器中确认
   * 路由已经部署，不会返回 AppSecret 或用户 OpenID。
   */
  if (url.pathname === "/api/qq/events" && request.method === "GET") {
    return json({
      ok: true,
      message: "Webhook endpoint ready",
    });
  }
  if (url.pathname === "/api/qq/events" && request.method === "POST") {
    return handleQqWebhook(request, env, ctx);
  }

  // 浏览器写操作只能来自本站；QQ 的服务端回调已在上方通过独立签名验证。
  rejectCrossSiteMutation(request);

  if (url.pathname === "/api/i18n/translate" && request.method === "POST") {
    return json({ error: "远程页面翻译已停用" }, 410);
  }

  // 健康检查会同时测试绑定、D1 连通性和实际数据表初始化。
  if (url.pathname === "/api/health" && request.method === "GET") {
    let databaseReachable = false;
    let schemaReadyForRequests = false;
    let schemaError = null;
    if (env.DB) {
      try {
        const probe = await env.DB.prepare("SELECT 1 AS ok").first();
        databaseReachable = Number(probe?.ok) === 1;
      } catch (error) {
        console.error("D1 health check failed", error);
      }
      if (databaseReachable) {
        try {
          await ensureSchema(env);
          schemaReadyForRequests = true;
        } catch (error) {
          schemaError = String(error?.message || error?.cause?.message || error).slice(0, 600);
          console.error("D1 schema health check failed", {
            message: error?.message || String(error),
            cause: error?.cause?.message || null,
          });
        }
      }
    }
    const ok = Boolean(env.DB && env.BUCKET && databaseReachable && schemaReadyForRequests);
    const qqBotConfigured = Boolean(env.QQ_BOT_APP_ID && env.QQ_BOT_SECRET);
    let qqRecipientBound = Boolean(env.QQ_TARGET_OPENID);
    if (qqBotConfigured && !qqRecipientBound && schemaReadyForRequests) {
      try { qqRecipientBound = Boolean(await getQqTargetOpenid(env)); }
      catch (error) { console.error("QQ notification binding health check failed", error); }
    }
    const publicStatus = { ok, version: APP_VERSION };
    const adminDiagnostics = schemaReadyForRequests && await isAdmin(request, env);
    if (!adminDiagnostics) return json(publicStatus, ok ? 200 : 503);
    return json({
      ok,
      version: APP_VERSION,
      bindings: {
        DB: Boolean(env.DB),
        BUCKET: Boolean(env.BUCKET),
        ASSETS: Boolean(env.ASSETS),
      },
      ai: {
        provider: env.DEEPSEEK_API_KEY ? "deepseek-direct" : "worker-upstream",
        streaming: true,
      },
      notifications: {
        feedbackWebhook: Boolean(
          env.FEEDBACK_WEBHOOK_URL
          || env.WECOM_WEBHOOK_URL
          || (qqBotConfigured && qqRecipientBound)
        ),
        qqBotConfigured,
        qqRecipientBound,
      },
      guestProtection: {
        turnstileConfigured: turnstileStatus(env).configured,
        turnstileIncomplete: turnstileStatus(env).incomplete,
        turnstileMissingSiteKey: turnstileStatus(env).missingSiteKey,
        turnstileMissingSecretKey: turnstileStatus(env).missingSecretKey,
        analyticsRetentionDays: GUEST_ANALYTICS_RETENTION_DAYS,
      },
      databaseReachable,
      schemaReady: schemaReadyForRequests,
      ...(schemaError ? { schemaError } : {}),
    }, ok ? 200 : 503);
  }

  await ensureSchema(env);

  if (url.pathname.startsWith("/api/shares/")) {
    if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "不支持的请求方法");
    const [, , , token, kind, id, extra] = url.pathname.split("/");
    if (extra !== undefined) throw new HttpError(404, "分享内容不存在");
    const share = await resolveShare(env, token, shareHooks());
    if (!kind || kind === "content" && id) {
      const response = json(!kind ? await shareListing(env, share) : await sharedContent(request, env, share, id, shareHooks()));
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (kind === "media" && id) return serveMedia(request, env, id, share);
    if (kind === "asset" && id) return serveAsset(request, env, id, share);
    throw new HttpError(404, "分享内容不存在");
  }

  /* 游客入口：先读取公开背景，再由 Turnstile + Worker 签发 24 小时游客会话。 */
  if (url.pathname === "/api/guest/config" && request.method === "GET") {
    const status = turnstileStatus(env);
    const limitSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'guest_daily_limit'").first();
    return json({
      enabled: status.configured,
      incomplete: status.incomplete,
      missingSiteKey: status.missingSiteKey,
      missingSecretKey: status.missingSecretKey,
      siteKey: status.configured ? status.siteKey : "",
      action: TURNSTILE_GUEST_ACTION,
      dailyLimit: Math.max(0, Number.parseInt(limitSetting?.value || "20", 10) || 0),
    });
  }
  if (url.pathname === "/api/guest/entry-background" && request.method === "GET") {
    await requireShareNavigationLogin(request, env);
    return json(await publicEntryBackground(env));
  }
  if (url.pathname === "/api/guest/enter" && request.method === "POST") {
    await requireShareNavigationLogin(request, env);
    return enterGuestWebsite(request, env);
  }
  if (url.pathname === "/api/guest/track" && request.method === "POST") {
    return json(await trackGuestWebsite(request, env));
  }

  /*
   * 登录账号、游客会话和站长会话进入网站主体后共用本接口持续复核。
   * 命中高置信度自动化信号时，函数会直接返回 403 并撤销当前会话。
   */
  if (url.pathname === "/api/security/heartbeat" && request.method === "POST") {
    return runtimeSecurityHeartbeat(request, env);
  }

  /* 普通用户注册、登录、资料、密码和会话接口。 */
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    return registerUser(request, env, ctx);
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    return loginUser(request, env);
  }
  if (url.pathname === "/api/auth/app/authorize" && request.method === "POST") {
    return authorizeAndroidLogin(request, env);
  }
  if (url.pathname === "/api/auth/app/redeem" && request.method === "POST") {
    return redeemAndroidLogin(request, env);
  }
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    return authSession(request, env);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return logoutUser(request, env);
  }
  if (url.pathname === "/api/auth/profile" && request.method === "PUT") {
    return json(await updateUserProfile(request, env));
  }
  if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
    return changeUserPassword(request, env);
  }
  if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
    return json(await requestPasswordReset(request, env, ctx));
  }
  if (url.pathname === "/api/auth/password-reset-info" && request.method === "POST") {
    return json(await passwordResetInfo(request, env));
  }
  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    return json(await resetUserPassword(request, env));
  }

  /* 已注册用户的通知信箱、提醒偏好与私信会话。 */
  if (url.pathname === "/api/notifications" && request.method === "GET") {
    return json(await notificationInbox(request, env));
  }
  if (url.pathname === "/api/notifications/read-all" && request.method === "POST") {
    return json(await updateNotification(request, env, "", "read-all"));
  }
  if (url.pathname.startsWith("/api/notifications/")) {
    const id = url.pathname.split("/").filter(Boolean)[2] || "";
    return json(await updateNotification(request, env, id, ""));
  }
  if (url.pathname === "/api/notification-preferences") {
    return json(await notificationPreferences(request, env));
  }
  if (url.pathname === "/api/messages") {
    return json(await privateMessages(request, env, url), request.method === "POST" ? 201 : 200);
  }

  /* AI 的前端按钮和后端接口都要求审核通过，不能只靠 CSS 隐藏。 */
  if (url.pathname === "/api/agent" && request.method === "POST") {
    const user = await requireApprovedUser(request, env);
    return json(await runSiteAgent(request, env, user));
  }
  if (["/api/agent/confirm", "/api/agent/cancel"].includes(url.pathname) && request.method === "POST") {
    await requireApprovedUser(request, env);
    const body = await readJson(request);
    const security = await contentSecurity(request, env);
    await ensureAgentActions(env);
    return json(await consumeAgentAction(env, security, body,
      { hash: sha256, error: (status, message) => new HttpError(status, message) }, url.pathname.endsWith("/cancel")));
  }

  if (url.pathname === "/api/ai" && request.method === "POST") {
    const sessionUser = await requireApprovedUser(request, env);
    if (url.searchParams.get("stream") === "1") return askAiStream(request, env, sessionUser);
    return json(await askAi(request, env, sessionUser));
  }

  if (url.pathname === "/api/bootstrap" && request.method === "GET") {
    await requireWebsiteVisitor(request, env);
    return json(await publicBootstrap(request, env));
  }
  if (url.pathname === "/api/content-unlock" && request.method === "POST") {
    await requireWebsiteVisitor(request, env);
    return json(await unlockContent(request, env));
  }
  if (url.pathname === "/api/content-release" && request.method === "POST") {
    await requireWebsiteVisitor(request, env);
    return json(await releaseContentGrants(request, env));
  }
  if (url.pathname.startsWith("/api/content-access/") && request.method === "GET") {
    await requireWebsiteVisitor(request, env);
    const [, , , kind, id] = url.pathname.split("/");
    if (!Object.hasOwn(SECURITY_TABLES, kind) || !validId(id)) throw new HttpError(400, "内容参数无效");
    const security = await contentSecurity(request, env, { targets: [{ kind, id }] });
    security.requireView(kind, id, { allowLocked: true });
    const access = security.decorate(kind, { id });
    return json({ id, locked: access.locked, locks: access.locks, canDownload: access.canDownload });
  }
  if (url.pathname.startsWith("/api/content/") && request.method === "GET") {
    await requireWebsiteVisitor(request, env);
    const id = url.pathname.split("/").filter(Boolean)[2];
    return json(await getPublicContent(request, env, id));
  }
  if (url.pathname === "/api/comments" && request.method === "GET") {
    await requireWebsiteVisitor(request, env);
    const contentId = url.searchParams.get("contentId") || "";
    if (!validId(contentId)) throw new HttpError(400, "缺少文章 ID");
    return json({ comments: await listPublicComments(request, env, contentId) });
  }
  if (url.pathname === "/api/comments" && request.method === "POST") {
    await requireWebsiteVisitor(request, env);
    return json(await createComment(request, env), 201);
  }
  if (url.pathname === "/api/feedback" && request.method === "GET") {
    await requireWebsiteVisitor(request, env);
    return json({ feedback: await listPublicFeedback(env) });
  }
  if (url.pathname === "/api/feedback" && request.method === "POST") {
    await requireWebsiteVisitor(request, env);
    const item = await createFeedback(request, env);
    if (ctx) ctx.waitUntil(notifyFeedback(env, item));
    return json({ id: item.id, created_at: item.created_at }, 201);
  }
  if (url.pathname === "/api/reactions" && request.method === "POST") {
    await requireWebsiteVisitor(request, env);
    return json(await react(request, env));
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return adminLogin(request, env);
  }
  if (url.pathname.startsWith("/api/admin/")) {
    const result = await handleAdmin(request, env, url);
    return result instanceof Response ? result : json(result);
  }
  throw new HttpError(404, "接口不存在");
}
