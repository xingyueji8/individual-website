# 星月集部署操作说明

## 发布流程

源码在 `src/web/` 和 `src/server/`，目录说明见[代码地图](code-map.md)。`wrangler.jsonc` 指定 Worker 入口 `src/server/worker.js`。发布时，Wrangler 调用 `npm run build` 生成 `dist/public/`，然后一起发布 Worker 和静态文件。

1. 在仓库中修改源码，运行 `npm test` 和 `npm run check`。
2. 提交源码到 GitHub。已连接的 Cloudflare Workers Builds 会构建和发布 `main`。不要上传生成的 `dist/`。
3. 在 Cloudflare 的 `xingyueji` Worker → **Deployments** 确认此次提交发布成功，再打开 [健康检查](https://xingyueji.com.cn/api/health) 和刚修改的页面。

`/api/health` 的 `ok: true` 表示数据库和绑定可用；仅凭版本号不能区分两次只整理代码的发布，要结合部署记录中的提交号。

## 文件资源库部署检查

- `wrangler.jsonc` 中 `assets.run_worker_first` 应保持为 `true`，否则文件请求会被静态资源层截获。
- R2 绑定名称仍为 `BUCKET`，不需要再创建第二个存储桶。
- D1 会自动建立 `asset_folders`、`assets`、`asset_variants` 和 `asset_uploads` 表。
- 第一次部署后先访问一次 `/api/health`，再打开 Studio；这会先完成数据库升级。
- 视频自动转码不是 R2 本身的能力。未开通 Cloudflare Stream 时，在 Studio 手动上传各清晰度版本；
  开通后可给视频填写 Stream HLS 地址以使用自适应画质。各清晰度独立下载仍使用上传到 R2 的版本文件。

## 留言消息通知（可选）

留言无论是否配置外部通知，都会先安全保存到 D1，并显示在 `/studio` 的“留言与反馈”中。

如需企业微信提醒：

1. 在企业微信群中添加群机器人并复制 Webhook 地址。
2. 打开 Cloudflare Worker → Settings → Variables and Secrets。
3. 新建加密 Secret，名称写 `WECOM_WEBHOOK_URL`，值粘贴完整 Webhook 地址。
4. 保存并重新部署后，新留言会按企业微信文本消息格式推送。

### QQ 官方机器人提醒

`wrangler.jsonc` 已填写机器人 AppID。QQ 机器人的 AppSecret 只能放在 Cloudflare，不能写进
HTML、`worker.js`、`wrangler.jsonc` 或 GitHub。

1. 打开 Cloudflare Worker → Settings → Variables and Secrets。
2. 新增加密 Secret `QQ_BOT_SECRET`，值填写 QQ 开放平台显示的 AppSecret。
3. 设置两个独立的随机 Secret（建议各 32 位字母数字）：`QQ_WEBHOOK_VALIDATION_TOKEN` 用于新建或重新验证回调；`QQ_BIND_CODE` 用于首次或更换接收人。如果已固定 `QQ_TARGET_OPENID`，无需绑定口令。
4. 保存并重新部署，访问 `https://xingyueji.com.cn/api/qq/events`；看到
   `Webhook endpoint ready` 仅表示路由可访问。
5. 打开 QQ 开放平台机器人的 Webhook 设置，回调地址填写：

```text
https://xingyueji.com.cn/api/qq/events?validation_token=替换成QQ_WEBHOOK_VALIDATION_TOKEN的值
```

6. 监听事件选择 `C2C_MESSAGE_CREATE`（单聊消息事件），然后保存并让平台完成回调验证。
7. 使用已加入沙箱的站长 QQ 给机器人发送以下指令：

```text
绑定网站通知 你在QQ_BIND_CODE中设置的口令
```

已有正确绑定继续接收已签名的消息；未设置口令时不能首次绑定或更换接收人。收到“星月集网站通知绑定成功”后，新留言就会直接发到该 QQ 会话。

最后以 Studio 管理员身份访问 `/api/health`，正常时会看到：

```json
{
  "notifications": {
    "feedbackWebhook": true,
    "qqBotConfigured": true,
    "qqRecipientBound": true
  }
}
```

其他第三方通知中转仍可使用 Secret `FEEDBACK_WEBHOOK_URL`。Worker 会发送包含 `event`、
`feedback` 和 `text` 的 JSON；中转地址及 API Key 同样不得提交到 GitHub。

## 注册审核和密码重置

- 游客首次访问可以选择“以游客身份进入”，无需创建账号。
- 用户注册后默认为“待审核”，QQ机器人会向已绑定的站长账号发送申请摘要。
- 在 `/studio` →“用户与审核”中批准账号后，用户即可使用 AI 和会员内容。
- 用户忘记密码时提交预留联系方式；站长核实身份后点击“生成链接”，把链接通过原联系方式发给用户。
- 重置链接有效期为24小时且只能使用一次；重新生成、成功重置或用户再次申请都会使旧链接失效。
- Studio 永远不会显示用户原始密码或密码哈希。

## 游客反机器人验证与访问统计

代码已经接好 Cloudflare Turnstile 的前端组件与 Worker 服务端 Siteverify。只有前端出现“验证通过”
并不算完成，Worker 还会再次向 Cloudflare 校验 Token；验证 Token 过期、重复使用或来源域名不匹配
都会被拒绝。

1. 在 Cloudflare 控制台打开 **Turnstile**，新建一个 Managed 小组件。
2. Hostname 只填写网站实际域名，例如 `xingyueji.com.cn`；如果同时使用 `www`，也把该域名加入。
3. 复制 Site Key 和 Secret Key。
4. 打开 Worker → **Settings → Variables and Secrets**，新增：
   - 普通变量 `TURNSTILE_SITE_KEY`：填写 Site Key；
   - 加密 Secret `TURNSTILE_SECRET_KEY`：填写 Secret Key；
   - 普通变量 `TURNSTILE_HOSTNAMES`：填写允许的域名，多个域名用英文逗号分隔；
   - 推荐加密 Secret `SESSION_SECRET`：填写一串独立随机字符，用于签发游客会话。
5. 保存并重新部署。访问 `/api/health`，确认 `guestProtection.turnstileConfigured` 为 `true`。

如果 Site Key 和 Secret Key 都没有配置，网站不会中断游客访问，但只会启用 IP 频率限制；如果只配置
其中一个，入口会提示配置不完整，避免出现看似验证、实际上未验证的状态。

游客通过后，D1 的 `guest_visits` 表会按日保存：匿名浏览器编号、脱敏 IP、IP 摘要、国家/省州/城市、
网络运营组织、浏览器、来源域名、首次/最近访问时间、进入次数、页面浏览数和最后访问板块。后台
`/studio` →“游客统计”可以查看每日汇总和单个浏览器的明细。完整 IP 和精确住址不会保存；定位信息
只来自 Cloudflare 的 IP 级大致定位。明细默认保存 90 天，并自动清理更早的数据。

统计日默认按 `Asia/Shanghai` 汇总。如需修改，在 Variables 中添加普通变量 `ANALYTICS_TIMEZONE`，
值填写 IANA 时区名称。

## Studio 的 Cloudflare Access（可选）

未使用 Access 时保留现有后台密码登录即可。使用邮箱白名单时，在 Cloudflare Zero Trust 为 Studio 页面和 `/api/admin/*` 配置同一 Access 应用和允许策略。在 Worker 的 Variables and Secrets 中一起填写：

- `ADMIN_ACCESS_EMAILS`：允许的管理员邮箱，多个用英文逗号分隔。
- `ADMIN_ACCESS_TEAM_DOMAIN`：该账户的团队域名，例如 `https://你的团队名.cloudflareaccess.com`（使用控制台中的实际值）。
- `ADMIN_ACCESS_AUD`：上述 Access 应用详情中的 **Application Audience (AUD) Tag**。

仅设置其中一部分时，Studio 将拒绝管理员登录，直到配置补齐；普通访问和分享不受影响。Worker 会验证 Cloudflare 签名、签发域、目标应用、有效期和邮箱，再验证 Studio 密码。

## 私有文件的存储入口

在 R2 → `xingyueji-media` → Settings 分别检查公共开发地址（r2.dev）和自定义域名。保存会员或私密原件的桶应只通过本站 Worker 读取，不应经另一个公开桶地址直接访问。
