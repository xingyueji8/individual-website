/** 版本日志及页脚版本同步。 */
import { readJson } from "../http/request.js";
import { APP_VERSION, HttpError } from "../http/responses.js";
import { clampText, nowIso, rows, validId } from "../shared/values.js";

async function syncSiteVersion(env, preferredVersion = "") {
  let version = clampText(preferredVersion, 30);
  if (!version) {
    const latest = await env.DB.prepare(
      "SELECT version FROM changelogs ORDER BY sort_order DESC, published_at DESC, created_at DESC LIMIT 1",
    ).first();
    version = latest?.version || APP_VERSION;
  }
  await env.DB.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('site_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(version, nowIso()).run();
  return version;
}

export async function adminChangelogs(request, env, id) {
  if (request.method === "GET") {
    return rows(await env.DB.prepare("SELECT * FROM changelogs ORDER BY sort_order DESC, published_at DESC, created_at DESC").all());
  }
  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    const version = clampText(body.version, 30);
    const title = clampText(body.title, 120);
    const logBody = clampText(body.body, 4000);
    const publishedDate = body.publishedAt ? new Date(body.publishedAt) : new Date();
    if (Number.isNaN(publishedDate.getTime())) throw new HttpError(400, "更新时间格式无效");
    const publishedAt = publishedDate.toISOString();
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
    if (!version || !title || !logBody) throw new HttpError(400, "版本号、标题和更新内容不能为空");
    const timestamp = nowIso();
    if (request.method === "POST") {
      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO changelogs (id, version, title, body, published_at, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId, version, title, logBody, publishedAt, sortOrder, timestamp, timestamp).run();
      await syncSiteVersion(env);
      return { id: newId };
    }
    if (!validId(id)) throw new HttpError(400, "更新记录 ID 错误");
    await env.DB.prepare(`
      UPDATE changelogs SET version = ?, title = ?, body = ?, published_at = ?, sort_order = ?, updated_at = ? WHERE id = ?
    `).bind(version, title, logBody, publishedAt, sortOrder, timestamp, id).run();
    // 编辑历史记录后以时间排序重新判断“当前版本”，避免旧日志误改页脚。
    await syncSiteVersion(env);
    return { id };
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM changelogs WHERE id = ?").bind(id).run();
    await syncSiteVersion(env);
    return { ok: true };
  }
  throw new HttpError(405, "不支持的请求方法");
}
