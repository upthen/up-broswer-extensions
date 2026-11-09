/** 生成并拍摄各增强视图的截图，用于人工/视觉校验（产物写到 .shots/） */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, '.shots')
mkdirSync(shots, { recursive: true })

const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1])
const js = scripts.find((s) => /main-/.test(s)) ?? scripts[scripts.length - 1]
const css = html.match(/href="([^"]+\.css)"/)?.[1]

const views = [
  { id: 'tree', title: '切换到树形视图' },
  { id: 'query', title: '切换到JSONPath' },
  { id: 'code', title: '切换到代码生成' },
]

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function makePage(file, mode, clickTitle) {
  const click = clickTitle
    ? `setTimeout(function(){
        var b=[...document.querySelectorAll('button')].find(x=>x.title===${JSON.stringify(clickTitle)});
        if(b) b.click();
      },1200);`
    : ''
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>
</head><body data-entry="${mode}"><div id="app" data-mode="${mode}"></div>
<script>${click}</script></body></html>`
  writeFileSync(resolve(dist, file), doc)
}

function shot(file, out, width, height, extra = []) {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=7000',
      ...extra,
      `--screenshot=${out}`,
      'file:///' + resolve(dist, file).replace(/\\/g, '/'),
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120000 },
  )
  console.log('shot →', out)
}

for (const view of views) {
  const file = `.shot-${view.id}.html`
  makePage(file, 'full', view.title)
  shot(file, resolve(shots, `view-${view.id}.png`), 1280, 800)
}

makePage('.shot-side.html', 'sidepanel', '切换到代码生成')
shot('.shot-side.html', resolve(shots, 'view-side-code.png'), 340, 740)

makePage('.shot-code-dark.html', 'full', '切换到代码生成')
shot('.shot-code-dark.html', resolve(shots, 'view-code-dark.png'), 1280, 800, ['--force-dark-mode'])
