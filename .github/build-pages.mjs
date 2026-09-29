import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const repository = process.env.GITHUB_REPOSITORY
if (!repository || !repository.includes('/')) {
  throw new Error('GITHUB_REPOSITORY must be in owner/repository format')
}

const [owner, name] = repository.split('/')
const baseUrl = `https://${owner.toLowerCase()}.github.io`
const url = name.toLowerCase() === `${owner.toLowerCase()}.github.io`
  ? baseUrl
  : `${baseUrl}/${name}`

writeFileSync('_config.pages.yml', `url: ${url}\n`)
execFileSync('pnpm', ['build:editor'], { stdio: 'inherit' })
execFileSync('pnpm', ['exec', 'hexo', 'generate', '--config', '_config.yml,_config.pages.yml'], {
  stdio: 'inherit',
})
