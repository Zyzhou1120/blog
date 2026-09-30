hexo.extend.injector.register('body_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/js/live.js?v=4')
  return `<script src="${url}" defer></script>`
})

hexo.extend.injector.register('head_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/css/reading.css?v=1')
  return `<link rel="stylesheet" href="${url}">`
})
