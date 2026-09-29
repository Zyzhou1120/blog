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

## 在浏览器中编辑文章

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

目前公开站点已上线，但自动发布工作流尚未启用。暂时在 GitHub 编辑文章后，网站不会自动更新。

## 从本地发布

仓库已经关联为 `origin`。修改本地文章后运行：

```bash
git add .
git commit -m "Update blog"
git push
```

自动发布工作流准备在 `.github/workflows/pages.yml`；启用后每次推送到 `main` 都会构建并发布。可以在仓库的 **Actions** 页面查看结果。

构建脚本会根据仓库名生成正确的网址，无需为 GitHub Pages 手工修改 `_config.yml`。本地的 `url` 保持为 `http://localhost:4000`。
