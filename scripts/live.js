hexo.extend.injector.register('body_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/js/live.js?v=11')
  return `<script src="${url}" defer></script>`
})

hexo.extend.injector.register('head_end', function () {
  const url = hexo.extend.helper.get('url_for').call(hexo, '/css/reading.css?v=6')
  const live = require('../realtime.config.json').endpoint
  return `${live ? '<meta name="blog-live-views" content="true">' : ''}<link rel="stylesheet" href="${url}">`
})
