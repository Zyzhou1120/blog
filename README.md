# 我的博客

这是一个使用 Hexo 和 Butterfly 的静态博客。文章在 `source/_posts/`，站点设置在 `_config.yml`，主题设置在 `_config.butterfly.yml`。

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

博客网址只用于阅读。登录 GitHub 后，打开仓库的 `source/_posts/` 文件夹：

- 修改旧文章：打开对应的 `.md` 文件，点击右上角的铅笔图标，编辑后点击 **Commit changes**。
- 发布新文章：点击 **Add file > Create new file**，文件名填 `source/_posts/文章名.md`，正文开头至少写上：

  ```markdown
  ---
  title: 文章标题
  date: 2026-09-29
  ---

  正文写在这里。
  ```

提交到 `main` 后，GitHub Actions 会重新生成网站。可以在仓库的 **Actions** 页面查看发布结果。

## 发布到 GitHub Pages

1. 在 GitHub 创建一个空仓库，记下仓库地址。在本目录执行以下命令，把用户名和仓库名换成自己的：

   ```bash
   git add .
   git commit -m "Initialize blog"
   git remote add origin https://github.com/用户名/仓库名.git
   git push -u origin main
   ```

2. 打开仓库的 **Settings > Pages**，把 **Build and deployment > Source** 设为 **GitHub Actions**。
3. 推送后，`.github/workflows/pages.yml` 会自动构建和发布。仓库名为 `blog` 时，地址是 `https://用户名.github.io/blog/`；仓库名为 `用户名.github.io` 时，地址是 `https://用户名.github.io/`。

构建脚本会根据仓库名生成正确的网址，无需为 GitHub Pages 手工修改 `_config.yml`。本地的 `url` 保持为 `http://localhost:4000`。
