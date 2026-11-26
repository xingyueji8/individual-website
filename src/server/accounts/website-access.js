/** 处理游客、会员、站长与分享访客的身份优先级。 */
import { getGuestSession, requireGuestSession } from "./guest-session.js";
import { getUserSession } from "./member-session.js";
import { isAdmin } from "./studio-session.js";
import { HttpError } from "../http/responses.js";
import { getCookie } from "../shared/request-meta.js";
import { validId } from "../shared/values.js";

async function ownerUserId(env) {
  const item = await env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_user_id'").first();
  return validId(item?.value) ? item.value : "";
}

const requestAccessContexts = new WeakMap();

export async function websiteAccessContext(request, env) {
  if (!requestAccessContexts.has(request)) requestAccessContexts.set(request, loadWebsiteAccessContext(request, env));
  return requestAccessContexts.get(request);
}

async function loadWebsiteAccessContext(request, env) {
  /*
   * 点击“游客浏览”后，公开站点必须严格按游客权限运行。即使同一浏览器还
   * 保留 Studio 或普通账号 Cookie，也不能借这些 Cookie 读取指定用户文章。
   * Studio 自身的 /api/admin/* 接口不经过这里，因此后台会话不会被破坏。
   */
  const guest = await getGuestSession(request, env);
  if (guest) {
    return {
      user: null,
      fullAccess: false,
      adminAccess: false,
      ownerAccess: false,
      guestMode: true,
    };
  }
  const user = await getUserSession(request, env);
  const admin = await isAdmin(request, env);
  const ownerId = await ownerUserId(env);
  return {
    user,
    fullAccess: user?.status === "approved",
    adminAccess: admin,
    ownerAccess: admin || Boolean(user?.id && ownerId && user.id === ownerId),
  };
}

export async function requireWebsiteVisitor(request, env) {
  await requireShareNavigationLogin(request, env);
  // 公开站点的显式游客身份优先；账号与 Studio Cookie 仍可留存但不得参与读取。
  const guest = await getGuestSession(request, env);
  if (guest) return { type: "guest", ...guest };
  const user = await getUserSession(request, env, false);
  if (user) return { type: "user", user };
  if (await isAdmin(request, env)) return { type: "admin" };
  return { type: "guest", ...(await requireGuestSession(request, env)) };
}

export async function requireShareNavigationLogin(request, env) {
  if (!getCookie(request, "xyj_share")) return;
  if ((await getUserSession(request, env, false))?.status === "approved" || await isAdmin(request, env)) return;
  throw new HttpError(401, "分享链接仅允许浏览所分享的作品，访问其他板块或功能请注册／登录", "SHARE_LOGIN_REQUIRED");
}

// Reuse the identity that the byte-level permission graph will read, including
// on video Range requests; share links and curated entry backgrounds have their own gates.
export async function requireMediaVisitor(request, env) {
  await requireShareNavigationLogin(request, env);
  const context = await websiteAccessContext(request, env);
  if (!context.guestMode && !context.user && !context.adminAccess) {
    throw new HttpError(401, "请先完成游客验证，或登录账号后继续访问");
  }
}
