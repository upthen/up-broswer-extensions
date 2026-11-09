// 调试辅助：把页面里的元素样式/尺寸打印出来（通过 document.title 回传）
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const js = html.match(/src="([^"]+\.js)"/)?.[1]
const css = html.match(/href="([^"]+\.css)"/)?.[1]

const probeJs = `
setTimeout(function () {
  const out = [];
  out.push('theme=' + document.documentElement.dataset.theme);
  const css = getComputedStyle(document.documentElement);
  out.push('accentSoft=' + css.getPropertyValue('--accent-soft').trim());
  out.push('surface=' + css.getPropertyValue('--surface').trim());
  const ag = document.querySelector('.cm-activeLineGutter');
  out.push('activeGutter=' + (ag ? ag.className + ' bg=' + getComputedStyle(ag).backgroundColor : 'none'));
  const al = document.querySelector('.cm-activeLine');
  out.push('activeLine=' + (al ? 'bg=' + getComputedStyle(al).backgroundColor : 'none'));
  const line0 = document.querySelector('.cm-line');
  out.push('line0=' + (line0 ? line0.className + ' bg=' + getComputedStyle(line0).backgroundColor : 'none'));
  const gut = document.querySelector('.cm-gutters');
  out.push('gutters=' + (gut ? 'bg=' + getComputedStyle(gut).backgroundColor : 'none'));
  const firstNum = document.querySelector('.cm-lineNumbers .cm-gutterElement');
  out.push('num=' + (firstNum ? firstNum.className + ' bg=' + getComputedStyle(firstNum).backgroundColor : 'none'));
  document.title = out.join(' | ');
}, 2000);
`

const probeHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script></head>
<body data-entry="full"><div id="app" data-mode="full"></div><script>${probeJs}</script></body></html>`

writeFileSync(resolve(dist, 'probe2.html'), probeHtml)

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const dom = execFileSync(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--force-dark-mode',
    '--disable-web-security',
    '--allow-file-access-from-files',
    '--window-size=1280,800',
    '--virtual-time-budget=6000',
    '--dump-dom',
    'file:///' + resolve(dist, 'probe2.html').replace(/\\/g, '/'),
  ],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] },
)

const title = dom.match(/<title>([^<]*)<\/title>/)?.[1] ?? '(no title)'
console.log(title.replace(/ \| /g, '\n'))
