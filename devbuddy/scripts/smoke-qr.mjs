/**
 * 二维码模块 UI 冒烟：生成实时更新、选项、容量报错、图片解码往返、模块切换与 340px 紧凑模式。
 *
 * 图片解码涉及 canvas.toBlob / createImageBitmap 等真实异步任务，用 --virtual-time-budget
 * 会把虚拟时钟快进完再 dump，导致误判；这里改用 CDP 真实时间 + 精确视口宽度，
 * 顺带让 @media (max-width: 400px) 在 340px 侧边栏下真正生效。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1])
const js = scripts.find((s) => /main-/.test(s)) ?? scripts.at(-1)
const css = html.match(/href="([^"]+\.css)"/)?.[1]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const common = String.raw`
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (predicate, rounds = 80) => {
  for (let i = 0; i < rounds; i += 1) { if (predicate()) return true; await sleep(100); }
  return false;
};
const results = [];
const ok = (name, pass, extra) => results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + String(extra).slice(0, 100) : ''));
const q = (sel) => [...document.querySelectorAll(sel)];
const setValue = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const visible = (sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; };
// 三个模块常驻 DOM，按钮 title 有重名，必须限定在二维码模块内点击
const clickQrTitle = (title) => { const b = q('.qr button').find(x => x.title === title); if (b) b.click(); };
const clickText = (sel, name) => { const b = q(sel).find(x => x.textContent.includes(name)); if (b) b.click(); };
const qrTab = (name) => clickText('.qr__tabs button', name);
const appTab = (name) => { const b = q('.tabs .tab').find(x => x.textContent.trim() === name); if (b) b.click(); };
const svgPath = () => document.querySelector('.qr__svg path')?.getAttribute('d') || '';
const statusText = () => document.querySelector('.qr__status')?.textContent || '';
const inputArea = () => document.querySelector('.qr__input');
const resultArea = () => document.querySelector('.qr__result');
const setInput = async (value) => { setValue(inputArea(), value); await sleep(260); };
`

const fullTests = String.raw`
  // 0) 切到二维码模块
  await sleep(900);
  const tab = q('.tabs .tab').find(b => b.textContent.trim() === '二维码');
  ok('顶栏存在二维码入口', !!tab);
  tab.click();
  await sleep(350);
  ok('二维码模块已显示', visible('.qr') && !visible('.tool') && !visible('.enc'));
  ok('初始内容为中文示例', !!inputArea() && inputArea().value.includes('研发好朋友'));
  ok('生成页显示 SVG 预览', visible('.qr__svg') && svgPath().length > 50);
  ok('状态栏显示版本与模块数', /版本 \d+/.test(statusText()), statusText());

  // 1) 实时生成：改内容矩阵随之变化
  const before = svgPath();
  await setInput('https://example.com/devbuddy-qr-test');
  ok('输入变化后二维码重新生成', svgPath() !== before && svgPath().length > 50);
  ok('字节统计随之更新', /\d+ 字节/.test(q('.qr .pane__meta')[0]?.textContent || ''), q('.qr .pane__meta')[0]?.textContent);

  // 2) 纠错等级 / 版本 / 配色
  const selects = q('.qr__settings select');
  ok('四项设置齐全', selects.length === 4, selects.length);
  setValue(selects[0], 'H');
  await sleep(260);
  ok('纠错等级切换生效', svgPath() !== before && (q('.qr__captext')[0]?.textContent || '').includes('H'));
  const pathH = svgPath();
  // 自动版本此时正好是 V5，固定版本特意选更大的 V8，才能验证矩阵确实变了
  setValue(selects[1], '8');
  await sleep(260);
  ok('固定版本 V8 生效', (q('.qr .pane__meta')[1]?.textContent || '').includes('V8') && svgPath() !== pathH, q('.qr .pane__meta')[1]?.textContent);
  setValue(selects[1], '0');
  await sleep(220);
  const preset = q('.presets button').find(b => b.title === '品牌蓝');
  if (preset) preset.click();
  await sleep(220);
  ok('配色预设改变前景色', document.querySelector('.qr__svg path')?.getAttribute('fill') === '#3b62f6');

  // 3) 超容量给出中文错误，载入示例后恢复
  await setInput('A'.repeat(1300));
  ok('超容量显示中文错误', !!document.querySelector('.qr__status--err') && statusText().includes('内容过长'), statusText());
  ok('超容量时隐藏预览', !visible('.qr__svg'));
  clickQrTitle('载入示例');
  await sleep(320);
  ok('载入示例后恢复预览', visible('.qr__svg') && !statusText().includes('内容过长'), statusText());

  // 4) 解码：示例二维码走完整「PNG 文件 → Canvas → jsQR」链路
  qrTab('解码图片');
  await sleep(280);
  ok('解码页显示投放区', visible('.qr__drop') && !!resultArea());
  ok('解码页初始结果为空', resultArea().value === '');
  clickQrTitle('载入示例二维码');
  await waitFor(() => (resultArea()?.value || '').length > 0 || statusText().includes('未识别') || statusText().includes('失败'));
  await sleep(250);
  ok('解码状态诊断', true, statusText() + ' | thumb=' + visible('.qr__thumb'));
  ok('示例图片已载入并显示缩略图', visible('.qr__thumb'));
  ok('识别结果还原中文与 emoji', (resultArea()?.value || '').includes('研发好朋友') && (resultArea()?.value || '').includes('🚀'), (resultArea()?.value || '').slice(0, 50));
  ok('状态栏显示识别成功', statusText().includes('识别成功'), statusText());
  const decodedText = resultArea()?.value ?? '';

  // 5) 结果放回生成输入（Ctrl+Enter 对应动作）
  clickText('.qr__actions button', '放回生成输入');
  await sleep(320);
  ok('结果放回后回到生成页', visible('.qr__input'));
  ok('放回内容与识别结果一致', inputArea()?.value === decodedText, inputArea()?.value?.slice(0, 40));

  // 6) 模块切换不丢输入
  appTab('JSON 格式化');
  await sleep(300);
  ok('可切回 JSON 模块', visible('.tool') && !visible('.qr'));
  appTab('二维码');
  await sleep(320);
  ok('二维码模块保留输入', inputArea()?.value === decodedText);
  ok('二维码模块保留配色', document.querySelector('.qr__svg path')?.getAttribute('fill') === '#3b62f6');
`

const compactTests = String.raw`
  await sleep(900);
  const toggle = q('button').find(b => b.title === '切换到二维码工具');
  ok('紧凑模式有二维码入口', !!toggle);
  toggle.click();
  await sleep(320);
  ok('紧凑模式可进入二维码', visible('.qr--compact'));
  ok('340px 顶栏无横向溢出', (() => { const el = document.querySelector('.topbar'); return !!el && el.scrollWidth <= el.clientWidth + 2; })(), document.querySelector('.topbar')?.clientWidth + '/' + document.querySelector('.topbar')?.scrollWidth);
  ok('紧凑模式两个面板上下堆叠', q('.qr--compact .pane').length === 2);
  qrTab('解码图片');
  await sleep(260);
  ok('紧凑模式可切到解码页', visible('.qr--compact .qr__drop'));
  clickQrTitle('载入示例二维码');
  await waitFor(() => (resultArea()?.value || '').length > 0 || statusText().includes('未识别') || statusText().includes('失败'));
  await sleep(200);
  ok('紧凑模式解码状态诊断', true, statusText());
  ok('紧凑模式也能识别二维码', (resultArea()?.value || '').includes('研发好朋友'));
  const back = q('button').find(b => b.title === '返回 JSON 工具');
  ok('紧凑模式可返回 JSON', !!back);
  back.click();
  await sleep(300);
  ok('返回后 JSON 编辑器可见', visible('.tool'));
`

const finish = String.raw`
  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = results.join('\n');
  document.body.appendChild(pre);
`

function makePage(file, mode, body) {
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>
</head><body data-entry="${mode}"><div id="app" data-mode="${mode}"></div>
<script>${common}\n(async () => {\n${body}\n${finish}\n})().catch(e => {
  const pre = document.createElement('pre');
  pre.id = 'smoke-result';
  pre.textContent = results.join(String.fromCharCode(10)) + String.fromCharCode(10) + 'ERROR ' + (e && e.stack || e && e.message);
  document.body.appendChild(pre);
});</script></body></html>`
  writeFileSync(resolve(dist, file), doc)
}

makePage('smoke-qr.html', 'full', fullTests)
makePage('smoke-qr-compact.html', 'sidepanel', compactTests)

/* ---------------- CDP：真实时间下跑完异步图片解码 ---------------- */
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'devbuddy-qr-'))
const chromeProc = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-web-security',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let port = 0
for (let i = 0; i < 100 && !port; i += 1) {
  const portFile = join(profile, 'DevToolsActivePort')
  if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || 0
  if (!port) await sleep(200)
}
if (!port) {
  chromeProc.kill()
  throw new Error('Chrome 调试端口未就绪')
}

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
})

let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve: done, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : done(msg.result)
  }
}
const send = (method, params = {}, sessionId) =>
  new Promise((done, reject) => {
    const mid = ++id
    pending.set(mid, { resolve: done, reject })
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })

async function run(file, width, height) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.navigate', { url: 'file:///' + resolve(dist, file).replace(/\\/g, '/') }, sessionId)

  let report = ''
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    try {
      const res = await send(
        'Runtime.evaluate',
        { expression: "document.querySelector('#smoke-result')?.textContent || ''", returnByValue: true },
        sessionId,
      )
      report = res.result?.value || ''
      if (report) break
    } catch {
      // 导航期间 execution context 会短暂失效，继续轮询
    }
    await sleep(200)
  }
  await send('Target.closeTarget', { targetId }).catch(() => {})
  return report || `FAIL 超时未拿到 ${file} 的测试结果`
}

const report = [
  await run('smoke-qr.html', 1280, 800),
  await run('smoke-qr-compact.html', 340, 740),
].join('\n')
console.log(report)
const fails = report.split('\n').filter((line) => line.startsWith('FAIL') || line.startsWith('ERROR')).length
console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}`)

ws.close()
chromeProc.kill()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  // Windows 上 Chrome 可能仍持有临时目录，忽略即可
}
process.exit(fails === 0 ? 0 : 1)
