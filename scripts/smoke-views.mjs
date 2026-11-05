/** 第二阶段增强视图的 UI 冒烟：切换视图、展开树、过滤查询、切换生成语言、切回文本 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1])
const js = scripts.find((s) => /main-/.test(s)) ?? scripts.at(-1)
const css = html.match(/href="([^"]+\.css)"/)?.[1]

const testScript = String.raw`
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
const q = (sel) => [...document.querySelectorAll(sel)];
const viewtab = (id) => q('.viewtab')[id];
const text = () => document.body.innerText;
const setValue = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

(async () => {
  await sleep(900);

  // 0) 默认仍是双栏文本编辑器
  ok('默认文本视图双编辑器', q('.cm-editor').length === 2, q('.cm-editor').length + ' 个');

  // 1) 树形视图：展开、筛选、类型徽标
  viewtab(1).click();
  await sleep(250);
  const rows0 = q('.node').length;
  ok('树形视图渲染节点', rows0 > 5, rows0 + ' 行');
  ok('树形节点有类型徽标', q('.node__badge').length === rows0);
  const caret = q('.node__caret:not(.node__caret--empty)')[1];
  if (caret) caret.click();
  await sleep(200);
  ok('展开节点后行数增加', q('.node').length > rows0, rows0 + ' → ' + q('.node').length);
  const filter = document.querySelector('.tree__search input');
  setValue(filter, 'email');
  await sleep(200);
  ok('树形筛选生效', q('.node').length === 1 && text().includes('email'), q('.node').length + ' 行');
  setValue(filter, '');
  await sleep(200);

  // 2) JSONPath：预设、过滤、错误提示、放回输入
  viewtab(2).click();
  await sleep(250);
  const expr = document.querySelector('.query__input input');
  ok('查询视图有结果', q('.hit').length > 0, q('.hit').length + ' 条');
  setValue(expr, '$.features[?(@.enabled == true)].title');
  await sleep(350);
  ok('过滤表达式命中 3 条', q('.hit').length === 3, q('.hit').length + ' 条');
  ok('结果包含路径', (q('.hit__path')[0] || {}).textContent?.includes("['features']"), (q('.hit__path')[0] || {}).textContent);
  setValue(expr, '$.features[?(@.price < )]');
  await sleep(350);
  ok('非法表达式有中文错误', !!document.querySelector('.query__err'), document.querySelector('.query__err')?.textContent?.trim().slice(0, 30));
  setValue(expr, '$.*');
  await sleep(350);

  // 3) 代码生成：换语言、改根名、代码内容
  viewtab(3).click();
  await sleep(250);
  const codeText = () => q('.gen__line code').map(n => n.textContent).join('\n');
  ok('默认生成 TypeScript', codeText().includes('export interface Root'), codeText().slice(0, 40));
  const lang = document.querySelector('.gen__bar select');
  setValue(lang, 'go');
  await sleep(250);
  ok('切换 Go 生效', codeText().includes('package model') && codeText().includes('type Root struct'), codeText().slice(0, 40));
  const rootInput = document.querySelector('.gen__field input.input');
  setValue(rootInput, 'AppCfg');
  await sleep(250);
  ok('自定义根名生效', codeText().includes('type AppCfg struct'), codeText().slice(0, 40));

  // 4) 顶栏 tab 与输出区 tab 联动
  const topTab = q('.tabs .tab').find(b => b.textContent.trim() === '树形视图');
  topTab.click();
  await sleep(250);
  ok('顶栏可切回树形视图', q('.node').length > 0 && !!document.querySelector('.viewtab--active'));

  // 5) 切回文本，原输出没丢
  viewtab(0).click();
  await sleep(300);
  ok('切回文本仍有双编辑器', q('.cm-editor').length === 2, q('.cm-editor').length + ' 个');
  ok('输出内容未丢失', (q('.cm-content')[1]?.textContent || '').includes('研发好朋友'));

  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = results.join('\n');
  document.body.appendChild(pre);
})().catch(e => {
  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = 'ERROR ' + (e && e.stack || e && e.message);
  document.body.appendChild(pre);
});
`

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>
</head><body data-entry="full"><div id="app" data-mode="full"></div>
<script>${testScript}</script></body></html>`
writeFileSync(resolve(dist, 'smoke-views.html'), page)

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let dom = ''
try {
  dom = execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--window-size=1280,800',
      '--virtual-time-budget=12000',
      '--dump-dom',
      'file:///' + resolve(dist, 'smoke-views.html').replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 40, stdio: ['ignore', 'pipe', 'ignore'] },
  )
} catch (error) {
  dom = error.stdout || ''
}

const match = dom.match(/<pre id="smoke-result">([\s\S]*?)<\/pre>/)
if (!match) {
  console.log('未拿到测试结果，页面可能没跑起来')
  process.exit(1)
}
const report = match[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .trim()
console.log(report)
const fails = report.split('\n').filter((line) => line.startsWith('FAIL') || line.startsWith('ERROR')).length
console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}`)
process.exit(fails === 0 ? 0 : 1)
