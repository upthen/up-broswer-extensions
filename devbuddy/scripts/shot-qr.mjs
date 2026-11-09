/**
 * 二维码模块截图：直接加载 dist 下的真实入口页面（file:// + ?module=qrcode），
 * 用 CDP 精确锁定 1280 / 460 / 340 三种宽度，并等待图片解码异步完成后再截。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, '.shots')
const archive = resolve(root, 'docs/screenshots')
mkdirSync(shots, { recursive: true })
mkdirSync(archive, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'devbuddy-qrshot-'))
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

async function waitDom(sessionId, expression, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (res.result?.value) return true
    } catch {
      // 导航期间 execution context 会短暂失效
    }
    await sleep(200)
  }
  return false
}

async function capture(name, { page, width, height, dark = false, decode = false }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId)
  if (dark) {
    await send(
      'Emulation.setEmulatedMedia',
      { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      sessionId,
    )
  }
  await send('Page.navigate', { url: `file:///${resolve(dist, page).replace(/\\/g, '/')}?module=qrcode` }, sessionId)

  const ready = await waitDom(sessionId, "!!document.querySelector('.qr') && !!document.querySelector('.qr__svg')")
  if (!ready) console.log('WARN 页面未就绪：', name)

  if (decode) {
    await send(
      'Runtime.evaluate',
      {
        expression: `(async () => {
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          [...document.querySelectorAll('.qr__tabs button')].find(b => b.textContent.includes('解码图片'))?.click();
          await wait(300);
          [...document.querySelectorAll('.qr button')].find(b => b.title === '载入示例二维码')?.click();
          return true;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
    await waitDom(sessionId, "(document.querySelector('.qr__result')?.value || '').includes('研发好朋友')", 20000)
    await sleep(2100) // 等 toast 消失
  } else {
    await sleep(400)
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
  const buffer = Buffer.from(data, 'base64')
  writeFileSync(resolve(shots, `${name}.png`), buffer)
  writeFileSync(resolve(archive, `${name}.png`), buffer)
  console.log('shot →', `${name}.png`, `${width}×${height}`, `${(buffer.length / 1024).toFixed(0)} KB`)
  await send('Target.closeTarget', { targetId }).catch(() => {})
}

await capture('qr-generate', { page: 'index.html', width: 1280, height: 800 })
await capture('qr-generate-dark', { page: 'index.html', width: 1280, height: 800, dark: true })
await capture('qr-decode', { page: 'index.html', width: 1280, height: 800, decode: true })
await capture('qr-popup', { page: 'popup.html', width: 460, height: 578 })
await capture('qr-sidepanel', { page: 'sidepanel.html', width: 340, height: 740, decode: true })

ws.close()
chromeProc.kill()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  // Windows 上 Chrome 可能仍持有临时目录
}
process.exit(0)
