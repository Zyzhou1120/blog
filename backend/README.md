# 实时发布服务

当前选择：Cloudflare Workers Free + SQLite Durable Object。`realtime.config.json` 的 `endpoint` 为空时，网站继续走原有 GitHub Pages 发布流程，不会请求未部署的后端。

## 启用

1. 博主本人注册/登录 Cloudflare。无需购买域名或开通付费套餐。
2. 在项目目录运行 `pnpm exec wrangler login --scopes account:read user:read workers_scripts:write`，由本人完成浏览器授权。
3. 运行 `pnpm exec wrangler deploy --config backend/wrangler.jsonc`。配置会同时创建 SQLite Durable Object，无需另外创建数据库。
4. 将部署返回的 HTTPS `workers.dev` 地址写入 `realtime.config.json` 的 `endpoint`。不要写入任何令牌。
5. 使用博主已有 GitHub 令牌向服务的 `POST /sync` 发送 `Authorization: Bearer …`，导入仓库中的文章；检查公开 `GET /posts` 和 `GET /posts/welcome.md`。令牌通过请求头传输，不能放进 URL、日志或配置文件。

编辑器删除文章时调用 `DELETE /posts/{文件名}`，请求体为 `{ "sha": "当前文章 SHA" }`。服务先核对仓库版本，在同一次 Git 提交中删除文章和指向它的旧链接，然后清除实时副本、浏览量、点赞与评论；发生版本冲突时返回 409，文章不会被删除。
6. 运行 `pnpm test:editor` 和 `TZ=Asia/Shanghai GITHUB_REPOSITORY=Zyzhou1120/blog node .github/build-pages.mjs`，提交并推送前端配置。构建脚本会同步编辑器 CSP，只允许配置的服务地址。
7. 用两个浏览器窗口验证：编辑窗口提交修改，已打开的普通文章页自动更新；再从首页进入，并验证新文章在静态构建完成前也能打开。

## 保存与权限

- 编辑器默认在此浏览器的 localStorage 中保持 GitHub 登录；取消“在此浏览器保持登录”时仅使用 sessionStorage。退出编辑会清除两处令牌，临时网络错误不会清除登录记录。
- 开启实时服务后，令牌会通过 HTTPS 传给博主自己的 Worker。文章和图片写入都向 GitHub 验证账户必须是 `Zyzhou1120`；实际仓库写入仍由 GitHub 校验令牌权限。
- Worker 不把令牌写入 SQLite、文章、日志或浏览器缓存。CORS 只允许博客站点的 origin；公开读取无须登录。
- 发布过程先向 GitHub 保存，再写入 SQLite 并广播 WebSocket 通知。返回成功后，编辑器还会读取公开 API，核对 SHA 和完整正文。不会因为构建清单变化就认定内容已上线。
- 多个编辑标签页使用内容 SHA 检查冲突。网络中断后重试能够恢复“GitHub 已保存、SQLite 尚未确认”的情况。
- 新文章通过 `/blog/read/?post=文件名.md` 立即可读；首页、最近文章和归档列表从服务刷新。已有文章的普通永久链接也读取实时内容。静态构建仍提供备用页面和搜索引擎可读内容。
- 通过 GitHub 网页或本地 Git 修改文章后，在编辑器点刷新文章列表，会将源文件同步到数据库。此类外部修改不自动触发实时通知，静态站点仍按 Actions 构建。

## 用量与边界

- 编辑器图片按钮支持选择本地文件，也可在正文中粘贴截图。上传经博主身份验证后写入 `source/images/uploads/`；相同文件按 SHA-256 去重。返回公开 GitHub 原始图片链接，无须等待 Pages 构建，不增加付费存储服务。
- 支持 PNG、JPEG、WebP、GIF，原图最多 10 MB；超过 2 MB 的静态图片在浏览器压缩至 2 MB 内，GIF 超过 2 MB 会提示缩小。服务端按文件签名和实际字节数校验，不接受 SVG/HTML。上传的图片为公开资源。

- 使用 Workers 免费套餐的请求和 SQLite 存储额度；没有创建付费资源或自动升级逻辑。
- WebSocket 使用休眠机制，页面隐藏时断开；重连后补读最新内容。连接断开时保留正文并提示，后台不可用时不会把旧内容当作新发布成功。
- 单篇 Markdown 最大 512 KB。首次同步适合个人博客；文章很多时需将导入拆分为批次，以避开单次 Durable Object 请求时间限制。
- 文章页和通用阅读地址使用同一套 SQLite 浏览计数。公开 `POST /views/:name` 接收浏览器随机访客标识，服务端按文章、上海日期和标识去重；公开 GET 只读取总数。存储每日散列并清理过期去重记录，不存 IP。改名后的别名共享原计数，刷新或重试不重复增加；禁用浏览器存储时只读取。旧不蒜子历史统计未迁移，新计数从启用时累计。
- “立即”指保存成功后直接读取数据库和接收通知，实际仍取决于 GitHub 写入和网络耗时，不保证零毫秒。

## 验证和回退

`pnpm test:editor` 包含真实 workerd/SQLite/WebSocket 本地运行测试及编辑器、阅读页集成测试。`pnpm exec wrangler deploy --dry-run --config backend/wrangler.jsonc` 检查上传包。

若需回退，将 `realtime.config.json` 的 `endpoint` 改回空字符串并重新发布静态站点；所有已确认保存的文章都仍在 GitHub。不要删除 Durable Object 或执行破坏性迁移。

## 点赞和评论

- 每篇文章首次初始化时生成一次浏览基础数 10–25、点赞基础数 5–15（点赞小于浏览）。基础数单独记录在 `engagement`；浏览总数保留已有真实访问并加上基础数，不随刷新重新随机。博主可用 `POST /initialize-engagement` 为所有已有文章幂等初始化。
- `GET /engagement/:name` 返回点赞和公开评论数；`POST /likes/:name` 接收每次点击生成的 `requestId`，允许同一访客反复点赞。同一网络请求重试不会重复增加，幂等记录保留一天。
- `GET /comments/:name?before=<id>` 每页最多 50 条公开评论。`POST /comments/:name` 接收昵称、纯文本正文、可选父评论、随机访客标识和请求 ID，立即公开。正文最多 2000 字、昵称最多 30 字；游客同一来源 10 秒内最多一次。来源按日散列且不保存原始 IP。
- 传入有效博主令牌的评论由服务端标记博主身份，客户端无法自行设置。评论只作为纯文本展示。
- 编辑器的“评论管理”调用受博主身份保护的 `GET/POST /manage-comments`：浏览、回复、软删除和恢复。隐藏评论不会出现在公开接口中；回复保留，并以“已删除的评论”表示被删除的父评论。
- 所有互动共用改名稳定的文章 ID。发布和文件备份继续存 GitHub；点赞、评论保存在现有 Durable Object SQLite 中。
