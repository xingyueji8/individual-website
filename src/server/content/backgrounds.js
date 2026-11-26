/** 登录入口公开背景图的 API 和 Studio 设置。 */
import {
  ENTRY_BACKGROUND_SETTING,
  entryBackgroundChoices,
  entryBackgroundPhotos,
  entryBackgroundSelectionAvailable,
  normalizeEntryBackgroundConfig,
  readEntryBackgroundConfig,
} from "./background-selection.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { nowIso } from "../shared/values.js";

/*
 * 登录入口的轮播背景在完成人机验证前也必须能够显示，因此使用一个最小接口：
 * 它只返回公开照片的背景展示地址，不返回标题、说明、文章或下载地址。
 */
export async function publicEntryBackground(env) {
  const { config } = await readEntryBackgroundConfig(env);
  const photos = await entryBackgroundPhotos(env, config);
  return {
    photos: photos.map((item) => ({
      // 背景与照片共用预览和权限校验，不通过背景入口暴露原片。
      url: `/media/${item.id}?background=1&v=${encodeURIComponent(String(item.updated_at || item.created_at || "1"))}`,
    })),
  };
}

export async function adminEntryBackground(request, env) {
  if (request.method === "GET") return entryBackgroundChoices(env);
  if (request.method !== "PUT") throw new HttpError(405, "不支持的请求方法");
  const input = await readJson(request);
  let config;
  try { config = normalizeEntryBackgroundConfig(input); }
  catch (error) { throw new HttpError(400, error.message); }
  const choices = await entryBackgroundChoices(env);
  if (!entryBackgroundSelectionAvailable(config, choices)) {
    throw new HttpError(409, "部分选择已不可用，请刷新图片列表并清除不可用选择后再保存；仅能选择公开、未上锁且有预览的照片及公开板块");
  }
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(ENTRY_BACKGROUND_SETTING, JSON.stringify(config), nowIso()).run();
  return { ...choices, config, invalidConfig: false };
}
