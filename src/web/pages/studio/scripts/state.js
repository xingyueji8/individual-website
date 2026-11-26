const app = {
  sections: [],
  subsections: [],
  content: [],
  changelogs: [],
  albums: [],
  media: [],
  assetFolders: [],
  assets: [],
  comments: [],
  feedback: [],
  guestAnalytics: null,
  users: [],
  passwordResets: [],
  userEvents: [],
  generatedResetLinks: new Map(),
  settings: {},
  currentAssetFolder: "",
  editorRange: null,
  variantTarget: null,
  posterTarget: null,
  assetUploadContext: null,
  messageContacts: [],
  messagePeer: null,
  feedbackArchive: false,
  visibilityEditor: null,
  articleSessionAssetIds: new Set(),
  articleAssetRemovalDecisions: new Map(),
  activeUploadJobs: new Set(),
  resumingUploadSessions: new Set(),
  busyMediaIds: new Set(),
  currentView: "dashboard",
  viewHistory: [],
  sectionEditorLevel: "section"
};
const viewInfo = {
  dashboard: ["概览", "查看网站目前的内容状态。"],
  "site-content": ["网站内容", "选择文章、图片或文件与视频，再进入对应的层级管理。"],
  sections: [
    "板块与内容编辑",
    "从左侧层级栏选择大板块、小板块或小小板块，在同一页面完成板块和内容编辑。"
  ],
  content: ["文章内容", "在任意文章类大板块中撰写、保存草稿并发布内容。"],
  changelogs: ["更新日志", "追加并保留每一次网站版本更新。"],
  media: ["图片", "预览上传、批量移动照片，分别设置查看、下载权限与密码锁。"],
  assets: ["文件与视频", "分片上传独立文件或文件夹，管理文档预览、视频清晰度和下载权限。"],
  comments: ["评论管理", "查看、隐藏或永久删除文章评论及其全部回复。"],
  feedback: ["留言与反馈", "处理注册用户的留言，并在已解决信箱中查看历史记录。"],
  messages: ["用户私信", "使用绑定的站长账号查看和发送站内私信。"],
  visitors: ["游客统计", "按日查看游客数量、页面访问、脱敏 IP、大致地区和设备信息。"],
  users: ["用户与审核", "审核注册申请、查看在线状态与登录痕迹、处理密码重置。"],
  settings: ["网站设置", "选择登录／注册背景，修改主页公开资料和本站使用说明。"]
};

// 所有板块与文件共用同一套五级权限名称。
const visibilityLabels = {
  public: "公开",
  member: "仅审核用户",
  selected: "仅指定用户",
  excluded: "不给指定用户看",
  private: "仅本人可见"
};
const profileAccessControls = Object.freeze({
  intro: ["setting-about-intro-visibility", "setting-about-intro-users"],
  school: ["setting-about-school-visibility", "setting-about-school-users"],
  learning: ["setting-about-learning-visibility", "setting-about-learning-users"],
  contact: ["setting-about-contact-visibility", "setting-about-contact-users"]
});

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    error.code = data?.errorCode || "";
    throw error;
  }
  return data;
}
function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value))
    : "";
}
function localDateTimeInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function clear(node) {
  node.replaceChildren();
}
function button(text, className = "btn small ghost") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}
