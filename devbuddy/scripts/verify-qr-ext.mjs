/**
 * 真实扩展环境验证：CDP Extensions.loadUnpacked 分别加载项目根目录与 dist/，
 * 检查二维码模块在 chrome-extension:// 页面（含 MV3 CSP）下能生成并解码。
 * 自启动 headless Chrome，端口由 DevToolsActivePort 自动分配，结束自动清理。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shots = resolve(root, '.shots')
mkdirSync(shots, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'devbuddy-extqr-'))
const chromeProc = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-extension-debugging',
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

async function waitDom(sessionId, expression, timeout = 18000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (res.result?.value) return true
    } catch {
      // 导航期间 context 短暂失效
    }
    await sleep(200)
  }
  return false
}

async function openPage(extId, prefix, page) {
  const url = `chrome-extension://${extId}/${prefix}${page}?module=qrcode`
  const { targetId } = await send('Target.createTarget', { url })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  return { targetId, sessionId, url }
}

async function check(label, path, prefix) {
  const loaded = await send('Extensions.loadUnpacked', { path })
  const extId = loaded.id
  const { targetId, sessionId } = await openPage(extId, prefix, 'index.html')
  const ready = await waitDom(sessionId, "!!document.querySelector('.qr') && !!document.querySelector('.qr__svg')")
  const generated = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      qrVisible: !!document.querySelector('.qr') && document.querySelector('.qr').offsetParent !== null,
      svgPathLen: (document.querySelector('.qr__svg path')?.getAttribute('d') || '').length,
      status: document.querySelector('.qr__status')?.textContent || '',
    })`,
    returnByValue: true,
  }, sessionId)
  console.log(`${label} 生成 →`, generated.result?.value)

  await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.qr__tabs button')].find(b => b.textContent.includes('解码图片'))?.click();
      await wait(300);
      [...document.querySelectorAll('.qr button')].find(b => b.title === '载入示例二维码')?.click();
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  const decodedOk = await waitDom(sessionId, "(document.querySelector('.qr__result')?.value || '').includes('研发好朋友')", 25000)
  const decoded = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      ok: ${decodedOk},
      text: (document.querySelector('.qr__result')?.value || '').slice(0, 40),
      thumb: !!document.querySelector('.qr__thumb'),
      status: document.querySelector('.qr__status')?.textContent || '',
      cspOk: !document.querySelector('.qr__toast')?.textContent?.includes('失败'),
    })`,
    returnByValue: true,
  }, sessionId)
  console.log(`${label} 解码 →`, decoded.result?.value)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
  writeFileSync(resolve(shots, `verify-qr-${label}.png`), Buffer.from(shot.data, 'base64'))
  await send('Target.closeTarget', { targetId }).catch(() => {})

  // 弹窗 / 侧边栏入口：确认紧凑模式的二维码按钮与页面都在
  for (const page of ['popup.html', 'sidepanel.html']) {
    const compact = await openPage(extId, prefix, page)
    const ok = await waitDom(compact.sessionId, "!!document.querySelector('.qr') && !!document.querySelector('button[title=\"返回 JSON 工具\"]')")
    const info = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ page: location.pathname, qr: !!document.querySelector('.qr'), compact: !!document.querySelector('.qr--compact'), svg: !!document.querySelector('.qr__svg') })`,
      returnByValue: true,
    }, compact.sessionId)
    console.log(`${label} ${page} →`, `ready=${ok}`, info.result?.value)
    await send('Target.closeTarget', { targetId: compact.targetId }).catch(() => {})
  }
  return { ready, decodedOk }
}

let failed = false
try {
  const results = [
    await check('root', root, 'dist/'),
    await check('dist', resolve(root, 'dist'), ''),
  ]
  failed = results.some((r) => !r.ready || !r.decodedOk)
} catch (error) {
  console.log('扩展验证失败 →', error instanceof Error ? error.message : String(error))
  failed = true
}
ws.close()
chromeProc.kill()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  // Windows 上 Chrome 可能仍持有临时目录
}
console.log(failed ? '\n真实扩展验证未通过' : '\n真实扩展验证通过：根目录与 dist/ 两种加载方式均可生成并解码')
process.exit(failed ? 1 : 0)
