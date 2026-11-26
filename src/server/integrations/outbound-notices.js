/** 注册、找回密码、留言的站外通知分发。 */
import { notifyQqFeedback } from "./qq.js";

/*
 * 留言通知采用“尽力发送”：D1 保存成功即向游客返回成功；微信/QQ 中转服务
 * 临时不可用只会写入 Worker 日志，不会让访客误以为留言丢失。
 *
 * - WECOM_WEBHOOK_URL：企业微信群机器人地址，按企业微信文本消息格式发送；
 * - FEEDBACK_WEBHOOK_URL：通用 HTTPS 中转地址，可接入自建 QQ/微信机器人。
 */
export async function notifyFeedback(env, item) {
  const categoryNames = { message: "留言", bug: "问题反馈", suggestion: "功能建议" };
  const summary = [
    `【星月集·${categoryNames[item.category] || "新留言"}】`,
    `署名：${item.guest_name}`,
    item.contact ? `联系方式：${item.contact}` : "联系方式：未填写",
    `内容：${item.body}`,
  ].join("\n");
  const jobs = [];

  if (/^https:\/\//i.test(env.WECOM_WEBHOOK_URL || "")) {
    jobs.push(fetch(env.WECOM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: summary } }),
      signal: AbortSignal.timeout(10_000),
    }));
  }
  if (/^https:\/\//i.test(env.FEEDBACK_WEBHOOK_URL || "")) {
    jobs.push(fetch(env.FEEDBACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "xingyueji.feedback.created", feedback: item, text: summary }),
      signal: AbortSignal.timeout(10_000),
    }));
  }
  if (env.QQ_BOT_APP_ID && env.QQ_BOT_SECRET) jobs.push(notifyQqFeedback(env, summary));
  const results = await Promise.allSettled(jobs);
  results.forEach((result) => {
    if (result.status === "rejected") console.error("Feedback notification failed", result.reason);
    else if (result.value instanceof Response && !result.value.ok) {
      console.error("Feedback notification HTTP error", result.value.status);
    }
  });
}

/* 注册和密码找回沿用同一个已绑定的 QQ 官方机器人接收人。 */
function contactTypeLabel(type) {
  return ({ qq: "QQ", wechat: "微信", email: "邮箱", phone: "手机号", other: "其他" })[type] || "其他";
}

export async function notifyRegistration(env, item) {
  const summary = [
    "【星月集·新注册申请】",
    `用户名：${item.username}`,
    `昵称：${item.nickname}`,
    `称呼：${item.displayName}`,
    `联系方式：${contactTypeLabel(item.contactType)} ${item.contact}`,
    item.note ? `备注：${item.note}` : "备注：未填写",
    item.inviteCode ? `邀请码：${item.inviteCode}` : "邀请码：未填写",
    "请进入星月集 Studio 的“用户与审核”页面处理。",
  ].join("\n");
  return notifyQqFeedback(env, summary);
}

export async function notifyPasswordResetRequest(env, item) {
  const summary = [
    "【星月集·密码重置申请】",
    `用户名：${item.username}`,
    `昵称：${item.nickname}`,
    `预留联系方式：${contactTypeLabel(item.contactType)} ${item.contact}`,
    "请先通过预留联系方式核实身份，再进入 Studio 生成一次性重置链接。",
  ].join("\n");
  return notifyQqFeedback(env, summary);
}
