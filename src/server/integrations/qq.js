/** QQ 回调验签、接收人绑定和官方消息发送。 */
import { ensureSchema } from "../db/initialize.js";
import { HttpError, json } from "../http/responses.js";
import { qqRecipientBinding } from "./qq-recipient.js";
import { sameSecretText, sha256 } from "../shared/crypto.js";
import { clampText, nowIso } from "../shared/values.js";

/*
 * QQ 官方机器人通知配置：
 * - QQ_BOT_APP_ID：机器人 AppID，可以放在 wrangler.jsonc 的 vars 中；
 * - QQ_BOT_SECRET：机器人 AppSecret，只能保存为 Cloudflare Secret；
 * - QQ_TARGET_OPENID：可选，直接指定接收通知的用户 OpenID；
 * - QQ_BIND_CODE：未固定 OpenID 时，首次或更换绑定必须提供此口令。
 * - QQ_WEBHOOK_VALIDATION_TOKEN：验证回调地址时必须匹配独立校验口令。
 *
 * 用户的普通 QQ 号不能代替 OpenID。若未配置 QQ_TARGET_OPENID，站长可先
 * 给机器人发送“绑定网站通知”，Worker 会从 QQ 的签名回调中读取 OpenID，
 * 并保存在 D1 settings 表中。这样无需把 OpenID 人工复制到 Cloudflare。
 */
const QQ_API_BASE = "https://api.bot.qq.com";

const QQ_OPENID_SETTING_KEY = "qq_notification_openid";

const QQ_BIND_COMMAND = "绑定网站通知";

const QQ_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;

// Worker 实例复用时缓存 access_token，减少向 QQ 鉴权接口发起的重复请求。
let qqAccessTokenCache = { appId: "", token: "", expiresAt: 0 };

let qqEd25519KeyCache = { appId: "", privateKey: null, publicKey: null };

/*
 * QQ Webhook 使用 Ed25519。QQ 官方给出的算法会把 AppSecret 不断重复，
 * 截取前 32 字节作为 seed。Web Crypto 导入 Ed25519 私钥时需要 PKCS#8，
 * 所以下面用固定的 Ed25519 PKCS#8 前缀把这 32 字节 seed 包装起来。
 */
function qqSeedFromSecret(secret) {
  const source = new TextEncoder().encode(String(secret || ""));
  if (!source.length) throw new HttpError(503, "QQ_BOT_SECRET 尚未配置");
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) seed[index] = source[index % source.length];
  return seed;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  const hex = String(value || "").trim();
  if (!/^[a-f0-9]{128}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g).map((part) => Number.parseInt(part, 16)));
}

async function qqEd25519Keys(env) {
  const appId = clampText(env.QQ_BOT_APP_ID, 80);
  if (!appId || !env.QQ_BOT_SECRET) throw new HttpError(503, "QQ 机器人 AppID 或 AppSecret 尚未配置");
  if (qqEd25519KeyCache.appId === appId && qqEd25519KeyCache.privateKey && qqEd25519KeyCache.publicKey) {
    return qqEd25519KeyCache;
  }

  const pkcs8Prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const seed = qqSeedFromSecret(env.QQ_BOT_SECRET);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + seed.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(seed, pkcs8Prefix.length);

  // 先导入可导出的私钥，再从 JWK 中取出 x（公钥）供回调验签使用。
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: privateJwk.x, ext: true, key_ops: ["verify"] },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  qqEd25519KeyCache = { appId, privateKey, publicKey };
  return qqEd25519KeyCache;
}

async function signQqValidation(env, eventTs, plainToken) {
  const { privateKey } = await qqEd25519Keys(env);
  const message = new TextEncoder().encode(`${eventTs}${plainToken}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, message)));
}

async function verifyQqWebhookSignature(request, rawBody, env) {
  const signature = hexToBytes(request.headers.get("X-Signature-Ed25519"));
  const timestamp = request.headers.get("X-Signature-Timestamp") || "";
  if (!signature || !timestamp) return false;
  const { publicKey } = await qqEd25519Keys(env);
  const message = new TextEncoder().encode(`${timestamp}${rawBody}`);
  return crypto.subtle.verify("Ed25519", publicKey, signature, message);
}

function webhookTimestampMilliseconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  if (/^\d{10,16}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length >= 13 ? numeric : numeric * 1000;
  }
  return Date.parse(raw);
}

function freshQqWebhookTimestamp(value) {
  const timestamp = webhookTimestampMilliseconds(value);
  return Number.isFinite(timestamp)
    && Math.abs(Date.now() - timestamp) <= QQ_WEBHOOK_MAX_SKEW_SECONDS * 1000;
}

async function claimQqWebhookEvent(env, payload, rawBody) {
  const eventId = clampText(payload.id || payload.d?.event_id || payload.d?.id, 500);
  const eventType = clampText(payload.t, 160);
  const eventKey = await sha256(`${eventType}\u0000${eventId || rawBody}`);
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO qq_webhook_events (event_key, event_type, received_at)
    VALUES (?, ?, ?)
  `).bind(eventKey, eventType, nowIso()).run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function getQqAccessToken(env) {
  const appId = clampText(env.QQ_BOT_APP_ID, 80);
  if (!appId || !env.QQ_BOT_SECRET) throw new Error("QQ 机器人 AppID 或 AppSecret 尚未配置");
  if (
    qqAccessTokenCache.appId === appId
    && qqAccessTokenCache.token
    && qqAccessTokenCache.expiresAt > Date.now() + 30_000
  ) return qqAccessTokenCache.token;

  const response = await fetch(`${QQ_API_BASE}/app/getAppAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: String(env.QQ_BOT_SECRET) }),
    signal: AbortSignal.timeout(10_000),
  });
  let result = {};
  try { result = await response.json(); } catch { /* 下方统一按鉴权失败处理。 */ }
  if (!response.ok || !result.access_token) {
    throw new Error(`QQ access_token 获取失败：${result.message || result.err_code || response.status}`);
  }
  const expiresIn = Math.max(60, Number(result.expires_in) || 7200);
  qqAccessTokenCache = {
    appId,
    token: String(result.access_token),
    expiresAt: Date.now() + Math.max(30, expiresIn - 60) * 1000,
  };
  return qqAccessTokenCache.token;
}

async function sendQqText(env, userOpenid, message, options = {}) {
  const appId = clampText(env.QQ_BOT_APP_ID, 80);
  const token = await getQqAccessToken(env);
  const body = {
    msg_type: 0,
    // 给通知预留少量平台字段空间，超长留言的完整内容仍保存在站长后台。
    content: String(message || "").slice(0, 1900),
  };
  if (options.msgId) {
    body.msg_id = String(options.msgId);
    body.msg_seq = 1;
  }

  const response = await fetch(`${QQ_API_BASE}/v2/users/${encodeURIComponent(userOpenid)}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `QQBot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    let result = {};
    try { result = await response.json(); } catch { /* 使用 HTTP 状态作为兜底错误。 */ }
    throw new Error(`QQ 消息发送失败：${result.err_code || response.status} ${result.message || ""}`.trim());
  }
  return { ok: true, appId };
}

export async function getQqTargetOpenid(env) {
  const fixedOpenid = clampText(env.QQ_TARGET_OPENID, 180);
  if (fixedOpenid) return fixedOpenid;
  if (!env.DB) return "";
  const saved = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(QQ_OPENID_SETTING_KEY).first();
  return clampText(saved?.value, 180);
}

async function saveQqTargetOpenid(env, userOpenid) {
  await env.DB.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(QQ_OPENID_SETTING_KEY, userOpenid, nowIso()).run();
}

/*
 * QQ 开放平台会先发送 op=13 验证回调地址；正式事件为 op=0。
 * 正式事件必须通过 X-Signature-Ed25519 验证，成功后用 op=12 回包。
 */
export async function handleQqWebhook(request, env, ctx) {
  const appId = clampText(env.QQ_BOT_APP_ID, 80);
  if (!appId || !env.QQ_BOT_SECRET) throw new HttpError(503, "QQ 机器人尚未完成配置");
  if (request.headers.get("X-Bot-Appid") !== appId) throw new HttpError(401, "QQ 回调 AppID 不匹配");

  const rawBody = await request.text();
  let payload;
  try { payload = JSON.parse(rawBody); } catch { throw new HttpError(400, "QQ 回调 JSON 格式错误"); }

  if (Number(payload.op) === 13) {
    const plainToken = clampText(payload.d?.plain_token, 300);
    const eventTs = clampText(payload.d?.event_ts, 80);
    if (!plainToken || !eventTs) throw new HttpError(400, "QQ 回调验证参数不完整");
    if (!freshQqWebhookTimestamp(eventTs)) throw new HttpError(401, "QQ 回调验证请求已过期");
    const configuredToken = String(env.QQ_WEBHOOK_VALIDATION_TOKEN || "").trim();
    const suppliedToken = new URL(request.url).searchParams.get("validation_token") || "";
    if (!configuredToken || !suppliedToken || !(await sameSecretText(suppliedToken, configuredToken))) {
      throw new HttpError(403, "QQ 回调验证入口未授权");
    }
    return json({ plain_token: plainToken, signature: await signQqValidation(env, eventTs, plainToken) });
  }

  if (!freshQqWebhookTimestamp(request.headers.get("X-Signature-Timestamp"))) {
    throw new HttpError(401, "QQ 回调时间戳无效或已经过期");
  }
  if (!(await verifyQqWebhookSignature(request, rawBody, env))) {
    throw new HttpError(401, "QQ 回调签名无效");
  }
  if (Number(payload.op) !== 0) return json({ op: 12 });

  if (payload.t === "C2C_MESSAGE_CREATE") {
    await ensureSchema(env);
    if (!(await claimQqWebhookEvent(env, payload, rawBody))) return json({ op: 12 });
    const userOpenid = clampText(payload.d?.author?.user_openid || payload.d?.author?.id, 180);
    const messageId = clampText(payload.d?.id, 240);
    const content = clampText(payload.d?.content, 500).replace(/\s+/g, " ");

    if (userOpenid && messageId && (content === QQ_BIND_COMMAND || content.startsWith(`${QQ_BIND_COMMAND} `))) {
      const suppliedCode = content.slice(QQ_BIND_COMMAND.length).trim();
      const requiredCode = String(env.QQ_BIND_CODE || "").trim();
      const fixedOpenid = clampText(env.QQ_TARGET_OPENID, 180);
      const savedOpenid = await getQqTargetOpenid(env);
      const codeAccepted = requiredCode ? await sameSecretText(suppliedCode, requiredCode) : false;
      let reply;

      const decision = qqRecipientBinding(userOpenid, fixedOpenid, savedOpenid, codeAccepted);
      if (decision === "fixed-other") {
        reply = "绑定失败：Cloudflare 已通过 QQ_TARGET_OPENID 固定了其他接收账号。";
      } else if (decision === "denied") {
        reply = "绑定失败。请站长配置 QQ_BIND_CODE 后，通过私聊提供绑定口令。";
      } else {
        if (decision === "save") await saveQqTargetOpenid(env, userOpenid);
        reply = "星月集网站通知绑定成功。以后有新留言时，我会通过 QQ 提醒你。";
      }

      const replyJob = sendQqText(env, userOpenid, reply, { msgId: messageId })
        .catch((error) => console.error("QQ binding reply failed", error));
      if (ctx) ctx.waitUntil(replyJob); else await replyJob;
    }
  }
  return json({ op: 12 });
}

export async function notifyQqFeedback(env, summary) {
  if (!env.QQ_BOT_APP_ID || !env.QQ_BOT_SECRET) return { skipped: true };
  const userOpenid = await getQqTargetOpenid(env);
  if (!userOpenid) {
    console.warn("QQ notification skipped: no QQ_TARGET_OPENID or bound OpenID");
    return { skipped: true };
  }
  return sendQqText(env, userOpenid, summary);
}
