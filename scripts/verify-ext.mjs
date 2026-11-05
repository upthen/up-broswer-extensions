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
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value
  const info = await evalJs(`JSON.stringify({
    title: document.title,
    url: location.href,
    bodyLen: document.body.innerText.trim().length,
    hasEditor: !!document.querySelector('.cm-editor'),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 8)
  })`)
  console.log(`${page} →`, info)

  // 三个入口都验证「编码转换」模块能进入、工具齐全、能切回 JSON
  const enterExpr =
    page === 'index.html'
      ? `[...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === '编码转换')`
      : `[...document.querySelectorAll('button')].find(b => b.title === '切换到编码转换')`
  const moduleInfo = await evalJs(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const enter = ${enterExpr};
    if (!enter) return JSON.stringify({ toggle: false });
    enter.click(); await wait(350);
    const enc = document.querySelector('.enc');
    const encVisible = !!enc && enc.offsetParent !== null;
    const tools = document.querySelectorAll('.toolitem').length;
    const out = document.querySelectorAll('.epane__area')[1]?.value || '';
    const back = ${page === 'index.html'
      ? `[...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === 'JSON 格式化')`
      : `[...document.querySelectorAll('button')].find(b => b.title === '切换到 JSON 工具')`};
    if (back) back.click(); await wait(320);
    return JSON.stringify({ toggle: true, encVisible, tools, base64Len: out.length, editors: document.querySelectorAll('.cm-editor').length });
  })()`)
  console.log(`  编码模块 →`, moduleInfo)

  // 全屏页额外验证第二阶段视图在真实扩展环境中可用
  if (page === 'index.html') {
    const views = await evalJs(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const clickTab = (label) => {
        const btn = [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === label);
        if (btn) btn.click();
      };
      clickTab('树形视图'); await wait(250);
      const treeRows = document.querySelectorAll('.node').length;
      clickTab('JSONPath'); await wait(350);
      const hits = document.querySelectorAll('.hit').length;
      clickTab('代码生成'); await wait(250);
      const code = [...document.querySelectorAll('.gen__line code')].map(n => n.textContent).join('\\n');
      clickTab('JSON 格式化'); await wait(250);
      return JSON.stringify({ treeRows, hits, tsInterface: code.includes('export interface Root'), editors: document.querySelectorAll('.cm-editor').length });
    })()`)
    console.log(`  增强视图 →`, views)

    const encoding = await evalJs(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const tab = [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === '编码转换');
      if (tab) tab.click(); await wait(320);
      const jwt = [...document.querySelectorAll('.toolitem')].find(b => b.textContent.includes('JWT'));
      if (jwt) jwt.click(); await wait(250);
      const sample = [...document.querySelectorAll('button')].find(b => b.title === '载入示例');
      if (sample) sample.click(); await wait(350);
      const cards = document.querySelectorAll('.jwt__card').length;
      const claims = document.querySelectorAll('.jwt__claim').length;
      const warn = [...document.querySelectorAll('.jwt__warn')].map(n => n.textContent).join('');
      const back = [...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === 'JSON 格式化');
      if (back) back.click(); await wait(280);
      return JSON.stringify({ cards, claims, noVerify: warn.includes('不校验签名'), editors: document.querySelectorAll('.cm-editor').length });
    })()`)
    console.log(`  JWT 解码 →`, encoding)
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(`.shots/verify-${shotName}.png`, Buffer.from(shot.data, 'base64'))
}

await check('popup.html', `${tag}-popup`)
await check('index.html', `${tag}-full`)
await check('sidepanel.html', `${tag}-side`)
ws.close()
process.exit(0)
