hexo.extend.injector.register('body_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/js/live.js?v=3')
  return `<script src="${url}" defer></script>`
})
