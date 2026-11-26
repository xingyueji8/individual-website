/** 首次启动写入站点默认设置；已有站长设置继续保留。 */
/*
 * “本站使用说明”的初始正文只保存在数据层，不再硬编码进 index.html。
 * Worker 首次升级会把它写入 D1；之后站长可在 Studio 中自由编辑或清空。
 * 段落之间使用一个空行，前端会据此安全地生成独立段落。
 */
const DEFAULT_USAGE_GUIDE = [
  "欢迎来到星月集的网站！",
  "本站为星月集的个人空间，可视作朋友圈/QQ空间的平替。不论是生活中的感悟，还是学术上的探索，抑或是一些文章随笔，日后都将在该网站上进行发表，朋友圈/QQ空间除特殊事件以外，将逐步停更。",
  "同时，该网站目前仍处于建设状态，网站功能将持续丰富。受限于掌握知识有限，目前该网站仍由 ChatGPT 参与建设。随着前端学习的深入，GPT 将逐渐退出建设者的角色。",
  "本站托管在海外平台，故建议浏览者使用非公用网络进行登录，以防被拦截从而导致浏览失败。若有更多关于网站建设的想法，也欢迎与星月集进行联系沟通！",
].join("\n\n");

const defaultSettings = [
  ["site_title", "星月集"],
  ["owner_name", "星月集"],
  ["school", "北京理工大学 计算机学院"],
  ["intro", ""],
  ["usage_guide", DEFAULT_USAGE_GUIDE],
  ["contact_email", "1598116329@qq.com"],
  ["owner_user_id", ""],
  ["guest_daily_limit", "20"],
  ["about_heading", "关于我"],
  ["about_intro", ""],
  ["about_school_label", "就读院校与专业"],
  ["about_learning_title", "目前学习方向"],
  ["about_learning_items", "Python\nC\nHTML / CSS / JavaScript\nOpenHarmony开发"],
  ["about_contact_title", "联系方式"],
  ["contact_email_label", "国内邮箱"],
  ["contact_email_intl", "xingyueji8@gmail.com"],
  ["contact_email_intl_label", "国际邮箱"],
  ["about_intro_visibility", "public"],
  ["about_school_visibility", "public"],
  ["about_learning_visibility", "public"],
  ["about_contact_visibility", "public"],
];

export async function seedSiteSettings(env, timestamp) {
  const insert = "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)";
  await env.DB.batch(defaultSettings.map(([key, value]) => env.DB.prepare(insert).bind(key, value, timestamp)));
}
