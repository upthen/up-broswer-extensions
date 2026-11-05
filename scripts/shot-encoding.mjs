/** 拍摄 B8 编码模块各视图截图（亮/暗、全屏/弹窗/侧边栏），产物写到 .shots/ */
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

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const enterModule = (compact) =>
  compact
    ? `setTimeout(function(){var b=[...document.querySelectorAll('button')].find(x=>x.title==='切换到编码转换');if(b)b.click();},1000);`
    : `setTimeout(function(){var b=[...document.querySelectorAll('.tabs .tab')].find(x=>x.textContent.trim()==='编码转换');if(b)b.click();},1000);`
const pickTool = (name, at = 1500) =>
  `setTimeout(function(){var b=[...document.querySelectorAll('.toolitem')].find(x=>x.textContent.includes(${JSON.stringify(name)}));if(b)b.click();},${at});`
const loadSample = (at = 1900) =>
  `setTimeout(function(){var b=[...document.querySelectorAll('button')].find(x=>x.title==='载入示例');if(b)b.click();},${at});`

function makePage(file, mode, actions) {
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>
</head><body data-entry="${mode}"><div id="app" data-mode="${mode}"></div>
<script>${actions.join('\n')}</script></body></html>`
  writeFileSync(resolve(dist, file), doc)
}

/** headless 顶层窗口的 CSS 视口与 --window-size 不完全一致，用 iframe 精确锁定紧凑宽度 */
function makeFrame(file, innerFile, width, height) {
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}iframe{display:block;border:0;width:${width}px;height:${height}px}</style>
</head><body><iframe src="./${innerFile}"></iframe></body></html>`
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

makePage('.shot-enc-base64.html', 'full', [enterModule(false)])
shot('.shot-enc-base64.html', resolve(shots, 'enc-base64.png'), 1280, 800)

makePage('.shot-enc-unicode.html', 'full', [enterModule(false), pickTool('Unicode'), loadSample()])
shot('.shot-enc-unicode.html', resolve(shots, 'enc-unicode.png'), 1280, 800, ['--force-dark-mode'])

makePage('.shot-enc-jwt.html', 'full', [enterModule(false), pickTool('JWT'), loadSample()])
shot('.shot-enc-jwt.html', resolve(shots, 'enc-jwt.png'), 1280, 800)

makePage('.shot-enc-side.html', 'sidepanel', [enterModule(true), pickTool('JWT'), loadSample()])
makeFrame('.shot-enc-side-frame.html', '.shot-enc-side.html', 340, 740)
shot('.shot-enc-side-frame.html', resolve(shots, 'enc-side-jwt.png'), 340, 740)

makePage('.shot-enc-popup.html', 'popup', [enterModule(true)])
makeFrame('.shot-enc-popup-frame.html', '.shot-enc-popup.html', 460, 578)
shot('.shot-enc-popup-frame.html', resolve(shots, 'enc-popup.png'), 460, 578)
