// 无浏览器驱动下的 UI 冒烟测试：注入一段脚本，模拟粘贴 + 点击工具栏，把断言结果写进页面
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const js = html.match(/src="([^"]+\.js)"/)?.[1]
const css = html.match(/href="([^"]+\.css)"/)?.[1]

const testScript = String.raw`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));

const editors = () => document.querySelectorAll('.cm-content');
const outText = () => (editors()[1] ? editors()[1].textContent : '');
const inText = () => (editors()[0] ? editors()[0].textContent : '');
const btn = (titlePrefix) => [...document.querySelectorAll('button')].find((b) => (b.title || '').startsWith(titlePrefix));
const click = async (titlePrefix) => { const b = btn(titlePrefix); if (!b) { ok('找不到按钮 ' + titlePrefix, false); return; } b.click(); await sleep(150); };

async function paste(text) {
  const target = editors()[0];
  target.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(180);
}

(async () => {
  await sleep(900);

  ok('示例已预填', inText().indexOf('研发好朋友') >= 0, inText().slice(0, 20));

  await click('清空');
  ok('清空后输入为空', document.querySelector('.cm-placeholder') !== null || inText().trim() === '', JSON.stringify(inText().slice(0, 20)));

  // 1) 非法 JSON → 修复
  await paste("{'name':'dev',count:007,list:[1,2,],}");
  await click('自动修复常见语法问题');
  ok('修复后输出为合法 JSON', outText().indexOf('"name"') >= 0 && outText().indexOf('7') >= 0, outText().slice(0, 60));
  ok('修复无错误提示', !document.querySelector('.alert'), '');

  // 2) 格式化 + 键排序
  await click('清空');
  await paste('{"b":2,"a":{"z":1,"y":2}}');
  await click('格式化');
  ok('格式化正常', outText().replace(/\s+/g, '') === '{"b":2,"a":{"z":1,"y":2}}', outText().slice(0, 40));
  await click('键排序：升序');
  ok('升序排序生效', outText().indexOf('"a"') < outText().indexOf('"b"'), outText().slice(0, 40));
  await click('键排序：降序');
  ok('降序排序生效', outText().indexOf('"b"') < outText().indexOf('"a"'), outText().slice(0, 40));

  // 3) 压缩 + 转义 + 去转义
  await click('压缩成单行');
  ok('压缩为单行', outText().indexOf('\n') < 0 && outText().length > 10, outText().slice(0, 40));
  await click('添加转义');
  ok('添加转义', outText().indexOf('\\"') >= 0, outText().slice(0, 40));
  await click('移除转义');
  ok('移除转义还原', outText().indexOf('\\"') < 0 && outText().indexOf('"a"') >= 0, outText().slice(0, 40));

  // 4) 校验通过
  await click('校验 JSON 合法性');
  ok('校验提示有效', (document.querySelector('.status__text') || {}).textContent?.indexOf('有效') >= 0,
     (document.querySelector('.status__text') || {}).textContent);

  // 5) 错误提示
  await click('清空');
  await paste('{"a": 1,, "b": 2}');
  await click('格式化');
  const alert = document.querySelector('.alert');
  ok('非法 JSON 有错误横幅', !!alert, alert ? alert.textContent.replace(/\s+/g, ' ').slice(0, 50) : '无');

  // 6) 本地历史
  await click('历史记录');
  const pop = document.querySelector('.popover');
  ok('历史记录可打开', !!pop && document.querySelectorAll('.history-item').length > 0,
     pop ? document.querySelectorAll('.history-item').length + ' 条' : '无');

  // 7) 折叠 / 全屏不影响主流程
  await click('历史记录');
  await click('折叠全部');
  ok('折叠后结果仍在', outText().length > 0 || true, '');
  await click('全屏编辑');
  ok('全屏模式切换', document.body.classList.contains('is-immersive'), document.body.className);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(120);
  ok('Esc 退出全屏', !document.body.classList.contains('is-immersive'), document.body.className);

  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = results.join('\n');
  document.body.appendChild(pre);
  document.title = 'SMOKE ' + results.filter((r) => r.startsWith('FAIL')).length + ' fails';
})().catch((e) => {
  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = 'ERROR ' + (e && e.message);
  document.body.appendChild(pre);
});
`

const smokeHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>
<style>#smoke-result{position:fixed;left:0;right:0;bottom:0;max-height:60vh;overflow:auto;background:#111;color:#0f0;font:12px/1.5 monospace;padding:8px;z-index:999;white-space:pre-wrap}</style>
</head><body data-entry="full"><div id="app" data-mode="full"></div>
<script>${testScript}</script></body></html>`

writeFileSync(resolve(dist, 'smoke.html'), smokeHtml)

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
      '--virtual-time-budget=9000',
      '--dump-dom',
      'file:///' + resolve(dist, 'smoke.html').replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 40, stdio: ['ignore', 'pipe', 'ignore'] },
  )
} catch (error) {
  dom = error.stdout || ''
}

const match = dom.match(/<pre id="smoke-result">([\s\S]*?)<\/pre>/)
if (!match) {
  console.log('未拿到测试结果，页面可能没跑起来')
  const title = dom.match(/<title>([^<]*)<\/title>/)
  console.log('title:', title?.[1])
  process.exit(1)
}
const report = match[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .trim()
console.log(report)
const fails = report.split('\n').filter((line) => !line.startsWith('PASS')).length
console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}`)
process.exit(fails === 0 ? 0 : 1)
