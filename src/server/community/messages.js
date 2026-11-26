/** 用户私信、联系人以及站长与用户会话。 */
import { publicUser, requireApprovedUser } from "../accounts/member-session.js";
import { createNotification } from "./notifications.js";
import { settingsObject } from "../content/settings.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

async function messagePeer(env, userId) {
  if (!validId(userId)) return null;
  return env.DB.prepare("SELECT id, username, nickname FROM users WHERE id = ? AND status = 'approved'")
    .bind(userId).first();
}

async function messageContactsFor(env, userId) {
  const result = await env.DB.prepare(`
    SELECT u.id, u.username, u.nickname,
      (SELECT body FROM private_messages m
       WHERE (m.sender_user_id = ? AND m.recipient_user_id = u.id)
          OR (m.sender_user_id = u.id AND m.recipient_user_id = ?)
       ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM private_messages m
       WHERE (m.sender_user_id = ? AND m.recipient_user_id = u.id)
          OR (m.sender_user_id = u.id AND m.recipient_user_id = ?)
       ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM private_messages m
       WHERE m.sender_user_id = u.id AND m.recipient_user_id = ? AND m.read_at IS NULL) AS unread_count
    FROM users u
    WHERE u.id <> ? AND u.status = 'approved'
      AND EXISTS (
        SELECT 1 FROM private_messages m
        WHERE (m.sender_user_id = ? AND m.recipient_user_id = u.id)
           OR (m.sender_user_id = u.id AND m.recipient_user_id = ?)
      )
    ORDER BY last_message_at DESC
  `).bind(userId, userId, userId, userId, userId, userId, userId, userId).all();
  return rows(result).map((item) => ({ ...item, unread_count: Number(item.unread_count || 0) }));
}

async function messageThreadFor(env, userId, peerId, markRead = true) {
  const peer = await messagePeer(env, peerId);
  if (!peer || peer.id === userId) throw new HttpError(404, "私信用户不存在");
  const result = await env.DB.prepare(`
    SELECT id, sender_user_id, recipient_user_id, body, read_at, created_at
    FROM private_messages
    WHERE (sender_user_id = ? AND recipient_user_id = ?)
       OR (sender_user_id = ? AND recipient_user_id = ?)
    ORDER BY created_at ASC LIMIT 300
  `).bind(userId, peerId, peerId, userId).all();
  if (markRead) {
    await env.DB.prepare(`
      UPDATE private_messages SET read_at = COALESCE(read_at, ?)
      WHERE sender_user_id = ? AND recipient_user_id = ?
    `).bind(nowIso(), peerId, userId).run();
  }
  return { peer, messages: rows(result) };
}

async function sendPrivateMessageFor(env, sender, recipientId, rawBody) {
  if (sender.status !== "approved") throw new HttpError(403, "账号通过审核后才能使用私信");
  const recipient = await messagePeer(env, recipientId);
  if (!recipient || recipient.id === sender.id) throw new HttpError(400, "请选择其他已审核用户");
  const body = clampText(rawBody, 2000);
  if (body.length < 1) throw new HttpError(400, "私信内容不能为空");
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO private_messages (id, sender_user_id, recipient_user_id, body, read_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).bind(id, sender.id, recipient.id, body, timestamp).run();
  await createNotification(env, recipient.id, {
    type: "message", title: `${sender.nickname} 发来一条私信`, body,
    targetUrl: `/#messages-${sender.id}`, actorUserId: sender.id,
  });
  return { id, sender_user_id: sender.id, recipient_user_id: recipient.id, body, created_at: timestamp };
}

export async function privateMessages(request, env, url) {
  const user = await requireApprovedUser(request, env);
  if (request.method === "GET" && !url.searchParams.get("userId")) {
    return { contacts: await messageContactsFor(env, user.id) };
  }
  if (request.method === "GET") {
    return messageThreadFor(env, user.id, url.searchParams.get("userId") || "");
  }
  if (request.method === "POST") {
    const input = await readJson(request);
    return sendPrivateMessageFor(env, user, clampText(input.recipientUserId, 80), input.body);
  }
  throw new HttpError(405, "不支持的请求方法");
}

async function ownerAccount(env) {
  const settings = await settingsObject(env);
  if (!validId(settings.owner_user_id)) return null;
  return env.DB.prepare("SELECT * FROM users WHERE id = ? AND status = 'approved'")
    .bind(settings.owner_user_id).first();
}

export async function adminMessages(request, env, id) {
  const owner = await ownerAccount(env);
  if (!owner) throw new HttpError(409, "请先在网站设置中绑定一个已审核账号作为站长账号");
  if (request.method === "GET" && !id) {
    return { owner: publicUser(owner), contacts: await messageContactsFor(env, owner.id) };
  }
  if (request.method === "GET") return messageThreadFor(env, owner.id, id);
  if (request.method === "POST") {
    const input = await readJson(request);
    return sendPrivateMessageFor(env, owner, clampText(input.recipientUserId || id, 80), input.body);
  }
  throw new HttpError(405, "不支持的请求方法");
}
