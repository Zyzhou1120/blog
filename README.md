# 我的博客

这是一个使用 Hexo 和 Butterfly 的静态博客。文章在 `source/_posts/`，站点设置在 `_config.yml`，主题设置在 `_config.butterfly.yml`。

- 公开预览：<https://zyzhou1120.github.io/blog/>
- 源码仓库：<https://github.com/Zyzhou1120/blog>

## 本地预览

需要 Node.js 24 和 pnpm 11。

```bash
pnpm install
pnpm server
```

浏览器打开 <http://localhost:4000/>。检查构建可运行 `pnpm build`。

## 写文章

```bash
pnpm exec hexo new "文章标题"
```

编辑生成的 `source/_posts/文章标题.md`。修改站名和作者时，编辑 `_config.yml` 中的 `title`、`author` 和 `description`。

## 在博客网页编辑文章

打开 <https://zyzhou1120.github.io/blog/editor/>。左侧写 Markdown，右侧实时预览；可以新建文章、打开旧文章、恢复本地草稿，然后提交到 GitHub。

首次使用时，在 GitHub 创建细粒度个人访问令牌：Repository access 只选 `Zyzhou1120/blog`，Repository permissions 中把 **Contents** 设为 **Read and write**。在编辑页输入令牌，不要把令牌发给别人或写进文章。默认勾选“在此浏览器保持登录”，令牌保存在此浏览器的 localStorage，刷新或重新打开编辑页后自动连接。取消勾选时仅保存在当前标签页的 sessionStorage。点击退出编辑会清除两处令牌。网络错误保留登录记录并允许重试；令牌失效时需要重新登录。

提交文章后，GitHub Actions 会自动构建并发布博客。编辑器右侧预览会立即更新；上方发布状态会核对公开网站中的文章版本，只有版本一致才显示“已发布”。点击“查看最新文章”可避开旧页面缓存；“发布记录”可查看构建失败的原因。文章页面也会检查版本并在发现更新时自动载入新页面。

编辑器提供标题、加粗、斜体、删除线、链接、图片网址、行内代码、代码块、公式、表格、引用和列表工具。支持行号、撤销重做、分栏切换、专注模式和双向滚动同步。快捷键和图片使用方法可在工具栏的帮助按钮中查看。

## 浏览量

公开文章继续使用不蒜子统计，在浏览器端按“文章路径 + 上海时区日期”去重。同一浏览器当天反复刷新不再发送计数请求，显示最近一次取得的总数；不同浏览器、设备或清除本地存储后会重新计数。它不是严格的跨设备独立访客统计，历史重复计数不会被扣除。浏览器无法保存去重记录时会暂停计数。

## 在 GitHub 网页编辑文章

博客网址只用于阅读。登录 GitHub 后，打开 <https://github.com/Zyzhou1120/blog/tree/main/source/_posts>：

- 修改旧文章：打开对应的 `.md` 文件，点击右上角的铅笔图标，编辑后点击 **Commit changes**。
- 发布新文章：点击 **Add file > Create new file**，文件名填 `文章名.md`，正文开头至少写上（日期改成当天）：

  ```markdown
  ---
  title: 文章标题
  date: 2026-09-29
  ---

  正文写在这里。
  ```

在 GitHub 保存文章后，工作流也会自动构建并发布博客。发布完成后刷新公开页面。

## 从本地发布

仓库已经关联为 `origin`。修改本地文章后运行：

```bash
git add .
git commit -m "Update blog"
git push
```

自动发布工作流在 `.github/workflows/pages.yml`；每次推送到 `main` 都会构建并发布。可以在仓库的 **Actions** 页面查看结果。

构建脚本会根据仓库名生成正确的网址，无需为 GitHub Pages 手工修改 `_config.yml`。本地的 `url` 保持为 `http://localhost:4000`。
