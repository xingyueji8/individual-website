/** 测试入口映射：npm run test:<分组>。 */
export const suites = {
  "studio": [
    "web/studio-ui.mjs"
  ],
  "access": [
    "server/android-login.mjs",
    "server/database-startup.mjs",
    "server/guest-mode-access.mjs",
    "server/security-boundaries.mjs"
  ],
  "upload": [
    "server/resumable-upload.mjs"
  ],
  "glass": [
    "web/glass-motion.mjs"
  ],
  "i18n": [
    "web/i18n.mjs"
  ],
  "organize": [
    "server/content-organize.mjs",
    "web/organize-ui.mjs"
  ],
  "photos": [
    "web/photo-viewer-ui.mjs"
  ],
  "pdf": [
    "web/article-pdf.mjs",
    "web/article-pdf-render.mjs"
  ],
  "mobile": [
    "web/mobile-entry-ui.mjs"
  ],
  "mobile-media": [
    "web/mobile-media.mjs",
    "web/video-playback.mjs"
  ],
  "background": [
    "server/entry-background.mjs",
    "web/entry-background-ui.mjs"
  ],
  "agent": [
    "server/site-agent.mjs",
    "web/site-agent-ui.mjs",
    "web/site-agent-interactions.mjs",
    "web/site-agent-visibility.mjs"
  ],
  "shares": [
    "server/shares.mjs",
    "web/shares-ui.mjs"
  ],
  "space": [
    "server/personal-space.mjs"
  ],
  "build": [
    "web/static-build.mjs"
  ]
};
