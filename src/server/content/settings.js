/** 从 D1 读取、筛选和保存站点与个人资料展示设置。 */
import { normalizedVisibility, replaceAllowedUsers, validatedAllowedUserIds } from "./visibility.js";
import { readJson } from "../http/request.js";
import { HttpError } from "../http/responses.js";
import { clampMultilineText, clampText, nowIso, rows } from "../shared/values.js";

/* 公开 bootstrap 只下发页面真正需要的展示设置，内部账号和机器人配置不外泄。 */
const PUBLIC_SETTING_KEYS = new Set([
  "site_title", "owner_name", "site_version", "school", "intro", "usage_guide",
  "contact_email", "about_heading", "about_intro", "about_school_label",
  "about_learning_title", "about_learning_items", "about_contact_title",
  "contact_email_label", "contact_email_intl", "contact_email_intl_label",
]);

/* “关于我”按四个固定部分独立授权；标题只有至少一个部分可见时才会下发。 */
export const PROFILE_SECTION_DEFINITIONS = Object.freeze({
  intro: {
    visibilityKey: "about_intro_visibility",
    settingKeys: ["about_intro"],
  },
  school: {
    visibilityKey: "about_school_visibility",
    settingKeys: ["school", "about_school_label"],
  },
  learning: {
    visibilityKey: "about_learning_visibility",
    settingKeys: ["about_learning_title", "about_learning_items"],
  },
  contact: {
    visibilityKey: "about_contact_visibility",
    settingKeys: [
      "about_contact_title", "contact_email_label", "contact_email",
      "contact_email_intl_label", "contact_email_intl",
    ],
  },
});

export async function settingsObject(env) {
  // *_initialized 仅用于数据库迁移，不属于网站公开设置，也不需要显示在后台表单。
  const result = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key NOT LIKE '%_initialized' ORDER BY key",
  ).all();
  return Object.fromEntries(rows(result).map((item) => [item.key, item.value]));
}

export function publicSettingsObject(settings, visibleProfileSections = Object.keys(PROFILE_SECTION_DEFINITIONS)) {
  const output = Object.fromEntries(
    Object.entries(settings || {}).filter(([key]) => PUBLIC_SETTING_KEYS.has(key)),
  );
  const visible = new Set(visibleProfileSections);
  for (const [sectionKey, definition] of Object.entries(PROFILE_SECTION_DEFINITIONS)) {
    if (visible.has(sectionKey)) continue;
    definition.settingKeys.forEach((key) => delete output[key]);
  }
  if (!visible.size) delete output.about_heading;
  output.about_visible_sections = [...visible];
  return output;
}

async function adminSettingsObject(env) {
  const [settings, accessResult] = await Promise.all([
    settingsObject(env),
    env.DB.prepare("SELECT section_key, user_id FROM profile_section_access_users ORDER BY section_key, user_id").all(),
  ]);
  const accessBySection = new Map();
  for (const item of rows(accessResult)) {
    if (!accessBySection.has(item.section_key)) accessBySection.set(item.section_key, []);
    accessBySection.get(item.section_key).push(item.user_id);
  }
  settings.profile_access = Object.fromEntries(
    Object.entries(PROFILE_SECTION_DEFINITIONS).map(([sectionKey, definition]) => [sectionKey, {
      visibility: normalizedVisibility(settings[definition.visibilityKey]),
      allowedUserIds: accessBySection.get(sectionKey) || [],
    }]),
  );
  return settings;
}

export async function adminSettings(request, env) {
  if (request.method === "GET") return adminSettingsObject(env);
  if (request.method === "PUT") {
    const body = await readJson(request);
    if ("owner_user_id" in body && clampText(body.owner_user_id, 80)) {
      const ownerUserId = clampText(body.owner_user_id, 80);
      const owner = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'approved'")
        .bind(ownerUserId).first();
      if (!owner) throw new HttpError(400, "站长绑定账号必须是已审核账号");
    }
    const allowed = new Map([
      ["site_title", 80], ["owner_name", 80], ["school", 160],
      ["intro", 1000], ["usage_guide", 6000],
      ["contact_email", 240], ["site_version", 30], ["owner_user_id", 80],
      ["guest_daily_limit", 8], ["about_heading", 80], ["about_intro", 3000],
      ["about_school_label", 120], ["about_learning_title", 120],
      ["about_learning_items", 3000], ["about_contact_title", 120],
      ["contact_email_label", 120], ["contact_email_intl", 240],
      ["contact_email_intl_label", 120],
    ]);
    const profileUpdates = [];
    if (body.profileAccess && typeof body.profileAccess === "object") {
      for (const [sectionKey, definition] of Object.entries(PROFILE_SECTION_DEFINITIONS)) {
        if (!Object.prototype.hasOwnProperty.call(body.profileAccess, sectionKey)) continue;
        const requested = body.profileAccess[sectionKey] || {};
        const visibility = normalizedVisibility(requested.visibility);
        const allowedUserIds = await validatedAllowedUserIds(env, visibility, requested.allowedUserIds);
        profileUpdates.push({ sectionKey, definition, visibility, allowedUserIds });
      }
    }
    const statements = [];
    for (const [key, max] of allowed) {
      if (!(key in body)) continue;
      statements.push(
        env.DB.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).bind(
          key,
          key === "guest_daily_limit"
            ? String(Math.max(0, Math.min(100000, Math.floor(Number(body[key]) || 0))))
            : (["usage_guide", "about_intro", "about_learning_items"].includes(key)
              ? clampMultilineText(body[key], max)
              : clampText(body[key], max)),
          nowIso(),
        ),
      );
    }
    for (const update of profileUpdates) {
      statements.push(env.DB.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(update.definition.visibilityKey, update.visibility, nowIso()));
    }
    if (statements.length) await env.DB.batch(statements);
    for (const update of profileUpdates) {
      await replaceAllowedUsers(env, "profile", update.sectionKey, update.allowedUserIds);
    }
    return adminSettingsObject(env);
  }
  throw new HttpError(405, "不支持的请求方法");
}
