/**
 * 用 CDP 真实校验扩展能否加载（比猜 ID 靠谱）。
 * 用法：
 *   node scripts/verify-ext.mjs "D:\\Personal\\devbuddy" root
 *   node scripts/verify-ext.mjs "D:\\Personal\\devbuddy\\dist" dist
 * 前置：已用 --enable-unsafe-extension-debugging --remote-debugging-port=9334 启动 Chrome。
 */
import { writeFileSync } from 'node:fs'

const [, , extPath, tag = 'ext'] = process.argv
const PORT = process.env.CDP_PORT || 9334

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
})

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })

const loaded = await send('Extensions.loadUnpacked', { path: extPath })
console.log('loadUnpacked →', JSON.stringify(loaded))
const extId = loaded.id
const prefix = tag === 'dist' ? '' : 'dist/'

const check = async (page, shotName) => {
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/${prefix}${page}` })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await new Promise((r) => setTimeout(r, 2500))
  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value
  const info = await evalJs(`JSON.stringify({
    title: document.title,
    url: location.href,
    bodyLen: document.body.innerText.trim().length,
    hasEditor: !!document.querySelector('.cm-editor'),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 8)
  })`)
  console.log(`${page} →`, info)
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(`.shots/verify-${shotName}.png`, Buffer.from(shot.data, 'base64'))
}

await check('popup.html', `${tag}-popup`)
await check('index.html', `${tag}-full`)
await check('sidepanel.html', `${tag}-side`)
ws.close()
process.exit(0)
