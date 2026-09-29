const markedKatex = require('marked-katex-extension')

hexo.extend.filter.register('marked:extensions', function (extensions) {
  extensions.push(...markedKatex({ throwOnError: false, trust: false }).extensions)
})

hexo.extend.injector.register('head_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/vendor/katex/katex.min.css')
  return `<link rel="stylesheet" href="${url}">`
})
