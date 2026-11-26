# 星月集

[个人网站](https://xingyueji.com.cn/) · [Studio 内容后台](https://xingyueji.com.cn/studio)

网站采用 HTML、CSS 和 JavaScript，Cloudflare Worker 负责 API，D1 存文章和账号等记录，R2 存图片和文件。刚接触代码时，先从[代码地图](docs/code-map.md)里找你想改的功能。

| 在哪 | 放什么 |
| --- | --- |
| [src/web/pages](src/web/pages) | 首页、Studio、账户、分享和文档预览的页面、样式和交互 |
| [src/web/features](src/web/features) | PDF 导出、视频、个人空间、上传、分享和桌面助手 |
| [src/web/shared](src/web/shared) | 共用的主题、语言和按钮动效 |
| [src/server](src/server) | 登录、权限、数据、上传和其他 Worker 接口 |
| [tests](tests) | 网站回归测试，以及使用合成数据的本地预览 |
| [docs](docs) | 如何改代码、如何发布、站点功能和安全复核 |

在仓库根目录运行：

```bash
npm ci
npm run dev
```

打开 [本地网站](http://localhost:8787)。如需登录本地 Studio，先把 `.dev.vars.example` 复制为 `.dev.vars`，用文件中的本地密码。开发模式使用本地 D1 和 R2，Wrangler 会在前端源码变动后重新构建。

`npm test` 运行回归测试；`npm run check` 检查正式构建，但不发布。源码应修改在 `src/`，`dist/public/` 是每次构建生成的文件。

[代码地图与修改示例](docs/code-map.md) · [部署与配置](docs/deploy.md) · [功能说明](docs/features.md) · [安全复核](docs/security-review.md)
