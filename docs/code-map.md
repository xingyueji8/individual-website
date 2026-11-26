# 星月集代码地图

## 先找到你要改的地方

| 想改什么 | 从这里看 |
| --- | --- |
| 首页标题、侧栏、入口上的 HTML 文案 | [首页页面](../src/web/pages/home/page.html)；由后台保存的站名和说明在 [site-settings.js](../src/web/pages/home/scripts/site-settings.js) 读入 |
| 首页日夜配色、按钮、手机侧栏 | [首页样式](../src/web/pages/home/styles)中的 `base.css`、`buttons.css`、`responsive.css`；跨页主题在 [共用样式](../src/web/shared/styles) |
| 个人空间层级、文章列表、照片排列 | [个人空间](../src/web/features/personal-space)。页面切换在 [navigation.js](../src/web/pages/home/scripts/navigation.js)，后台板块层级在 [boards.js](../src/server/content/boards.js) |
| 阅读文章和点击图片预览 | 首页脚本中的 [article-body.js](../src/web/pages/home/scripts/article-body.js)、[image-viewer.js](../src/web/pages/home/scripts/image-viewer.js) |
| 导出 PDF | [PDF 共用模块](../src/web/features/article-export) 控制压缩档位、图片准备和分页；[首页接入](../src/web/pages/home/scripts/article-pdf.js) 管权限、正文和实际保存；分享页在 [share.js](../src/web/features/share/share.js) 接入同一模块 |
| 手机登录、游客验证和背景轮播 | [登录样式](../src/web/pages/home/styles/sign-in.css)、[entry-auth.js](../src/web/features/account/entry-auth.js)、[entry.js](../src/web/pages/home/scripts/entry.js)。服务端验证在 [turnstile.js](../src/server/accounts/turnstile.js) |
| Studio 单栏布局、按钮位置 | [Studio 页面](../src/web/pages/studio/page.html)、[工作区样式](../src/web/pages/studio/styles/workspace.css)、[Studio 导航样式](../src/web/features/studio/boards/studio-navigation.css) |
| Studio 文章编辑、封面、板块、点击保存 | [Studio 页面脚本](../src/web/pages/studio/scripts)：`articles.js` 准备表单数据，`article-events.js` 处理点击和提交，`boards.js` 管板块；[富文本与编辑器工具](../src/web/features/studio/articles) |
| Studio 的批量上传、暂停、续传 | [上传交互](../src/web/pages/studio/scripts/upload-events.js)、[分片上传](../src/web/pages/studio/scripts/multipart-upload.js)、[续传记录](../src/web/pages/studio/scripts/upload-checkpoints.js)，对应 [Worker 上传服务](../src/server/media/file-upload.js) |
| 视频卡顿、清晰度、原画和下载 | [前端播放策略](../src/web/features/video/video-playback.js)、[首页资源查看器](../src/web/pages/home/scripts/resource-reader.js)、[Worker 文件响应](../src/server/media/file-response.js) |
| 分享、访问范围、内容锁与下载权限 | [Studio 分享](../src/web/features/studio/sharing/studio-share.js)、[分享页](../src/web/features/share/share.js)、[分享后端](../src/server/content/share-links.js)、[共享权限判断](../src/server/content/permission-graph.js)。改前端按钮时仍须保留 Worker 的校验 |
| 桌面助手小人、拖动和对话框 | [助手脚本和样式](../src/web/features/assistant)，当前动作贴图在 [assets/assistant](../src/web/assets/assistant) |
| 大小屏的全局按钮回弹 | [一份通用实现](../src/web/shared/fragments/button-motion.js)，各页面的绑定范围维护在自己的 `*-events.js` 或 `control-motion.js` |
| 注册审核、密码重置和 QQ 通知 | [账号与会话](../src/server/accounts)、[Studio 用户管理](../src/server/studio/users.js)、[QQ 回调](../src/server/integrations/qq.js) |

## 一个请求是怎么走的

`src/server/worker.js` 是总入口。界面的 `/api/...` 请求从 [http/api.js](../src/server/http/api.js) 找到功能；`/api/admin/...` 统一转到 [http/studio-api.js](../src/server/http/studio-api.js)，确认管理员身份再执行业务。照片和文件直链分别交给 `media/image-response.js` 和 `media/file-response.js`。业务代码按 `accounts/`、`content/`、`media/`、`community/`、`studio/`、`integrations/` 找。

`server/db/` 负责建立旧版、新版都能读取的数据结构：`tables.js` 定义表和索引，`structure.js` 补旧表字段，`legacy-data.js` 保留历史数据的迁移顺序。改文案、样式和按钮通常无需改数据库。

## 修改一个按钮的例子

以给首页侧栏按钮改圆角为例：

1. 在 `src/web/pages/home/page.html` 搜按钮显示文字或元素 ID，确认对应的 CSS 类。
2. 用编辑器搜索这个类，侧栏布局优先看 `home/styles/sidebar.css`，共用按钮看 `home/styles/buttons.css`。只影响这一页的样式留在首页目录。
3. 运行 `npm run dev`，用宽、窄两种窗口检查。提交前运行 `npm run test:glass`；如果改了多处，再跑 `npm test` 和 `npm run check`。

## 源文件和公开网址的关系

每页的 `page.html` 通过 `<!-- @include scripts/文件.js -->` 或 `<!-- @include styles/文件.css -->` 声明需要的片段。[构建脚本](../scripts/build-web.mjs) 按声明顺序拼出页面，浏览器仍按原有顺序执行脚本和应用样式。页面脚本是同一个经典脚本中的不同片段；调用其他片段的函数时，顺着模板找即可。

共用外观在 `src/web/shared/styles/`。其中 `theme/` 管字体和夜览，`page-components/` 管布局和组件，`glass/` 管按钮、面板和玻璃效果。各目录内按文件名前缀的数字顺序合并为原来的 `theme.css`、`vnext.css` 和 `material.css`，编号对应浏览器应用样式的顺序。

独立的公共脚本、样式和图片在源码中按用途分组，发布时沿用旧网址。例如 `features/article-export/article-pdf.js` 仍是 `/article-pdf.js`。不要把也叫 `article-pdf.js` 的第二个独立资源放进平级功能目录，构建会提示重名。

`assets/legacy/` 保存旧版可能引用的助手图，`vendor/` 保存外部 PDF 库及许可证。普通功能修改不需要读压缩后的外部库代码。

`npm run test:upload`、`npm run test:pdf`、`npm run test:shares` 可以单独测功能；更多分组见 [tests/suites.mjs](../tests/suites.mjs)。`npm run preview:space`、`npm run preview:pdf`、`npm run preview:photos` 启动各自的本地预览，测试页面不会被打包发布。
