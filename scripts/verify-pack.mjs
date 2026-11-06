/**
 * 验证打包结果：解压 zip → 用真实 Chrome 扩展环境（CDP Extensions.loadUnpacked）
 * 分别加载「解压根目录」与「解压后的 dist/」，检查三个模块、二维码生成/解码、
 * 弹窗与侧边栏入口；顺便检查 CRX3 文件头。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const zip = join(release, `DevBuddy-${version}-chrome-extension.zip`)
const crx = join(release, `DevBuddy-${version}.crx`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const ok = (label, cond, detail = '') => {
  results.push(!!cond)
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
}

if (!existsSync(zip)) {
  console.error(`找不到 ${zip}，请先执行 npm run pack`)
  process.exit(1)
}
if (existsSync(crx)) {
  const head = readFileSync(crx).subarray(0, 12)
  ok('CRX3 文件头有效', head.subarray(0, 4).toString() === 'Cr24' && head.readUInt32LE(4) === 3,
    `magic=${head.subarray(0, 4).toString()} version=${head.readUInt32LE(4)}`)
}

/* ---------- 解压（用系统 PowerShell，验证 zip 能被真实工具读取） ---------- */
const dest = mkdtempSync(join(tmpdir(), 'devbuddy-pack-'))
const ex = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
], { encoding: 'utf8', timeout: 180000, windowsHide: true })
const unpacked = join(dest, `DevBuddy-${version}`)
ok('zip 可被系统解压', existsSync(unpacked), ex.error?.message || ex.stderr?.trim() || '')
ok('解压后含根目录转发清单', existsSync(join(unpacked, 'manifest.json')))
ok('解压后含 dist 独立清单', existsSync(join(unpacked, 'dist', 'manifest.json')))
ok('解压后含安装说明', existsSync(join(unpacked, 'INSTALL.txt')))
ok('构建产物齐全', ['index.html', 'popup.html', 'sidepanel.html', 'background.js'].every((f) => existsSync(join(unpacked, 'dist', f))))
const assets = existsSync(join(unpacked, 'dist', 'assets')) ? readdirSync(join(unpacked, 'dist', 'assets')) : []
ok('assets 已打进包', assets.some((f) => /^main-.*\.js$/.test(f)) && assets.some((f) => f.endsWith('.css')), assets.join(', '))
ok('未混入冒烟临时页面', !readdirSync(join(unpacked, 'dist')).some((f) => /^smoke|\.probe/.test(f)))

/* ---------- 真实扩展环境 ---------- */
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'devbuddy-packchrome-'))
mkdirSync(join(root, '.shots'), { recursive: true })
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
  '--no-first-run', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })

let ws
try {
  let port = 0
  for (let i = 0; i < 100 && !port; i += 1) {
    const f = join(profile, 'DevToolsActivePort')
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0
    if (!port) await sleep(200)
  }
  if (!port) throw new Error('Chrome 调试端口未就绪')
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { done, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(JSON.stringify(msg.error))) : done(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const mid = ++id
    pending.set(mid, { done, fail })
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })
  const evalJs = async (sessionId, expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId)
    return r.result?.value
  }
  async function waitFor(sessionId, expression, timeout = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try { if (await evalJs(sessionId, expression)) return true } catch { /* 导航中 */ }
      await sleep(200)
    }
    return false
  }
  async function open(extId, prefix, page, query = '?module=qrcode') {
    const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/${prefix}${page}${query}` })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Runtime.enable', {}, sessionId)
    await send('Page.enable', {}, sessionId)
    return { targetId, sessionId }
  }

  for (const [label, path, prefix] of [
    ['解压根目录', unpacked, 'dist/'],
    ['解压 dist/', join(unpacked, 'dist'), ''],
  ]) {
    const loaded = await send('Extensions.loadUnpacked', { path })
    const extId = loaded.id
    const page = await open(extId, prefix, 'index.html')
    ok(`${label}：全屏页挂载`, await waitFor(page.sessionId, "!!document.querySelector('.app') && !!document.querySelector('.tabs')"))
    ok(`${label}：二维码模块已渲染`, await waitFor(page.sessionId, "!!document.querySelector('.qr__svg path') && document.querySelector('.qr__svg path').getAttribute('d').length > 20"))
    const switched = await evalJs(page.sessionId, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.tabs button')].find(b => b.textContent.trim() === '编码转换')?.click();
      await wait(250);
      const enc = document.querySelector('.brand__sub')?.textContent || '';
      [...document.querySelectorAll('.tabs button')][0]?.click();
      await wait(250);
      const json = document.querySelector('.brand__sub')?.textContent || '';
      [...document.querySelectorAll('.tabs button')].find(b => b.textContent.trim() === '二维码')?.click();
      await wait(250);
      return JSON.stringify({ enc, json, qr: document.querySelector('.brand__sub')?.textContent || '' });
    })()`, true)
    const labels = JSON.parse(switched || '{}')
    ok(`${label}：三个模块可切换`, labels.enc?.includes('编码转换') && labels.json?.includes('JSON') && labels.qr?.includes('二维码'), JSON.stringify(labels))

    await evalJs(page.sessionId, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.qr__tabs button')].find(b => b.textContent.includes('解码图片'))?.click();
      await wait(300);
      [...document.querySelectorAll('.qr button')].find(b => b.title === '载入示例二维码')?.click();
      return true;
    })()`, true)
    const decoded = await waitFor(page.sessionId, "(document.querySelector('.qr__result')?.value || '').includes('研发好朋友')", 25000)
    ok(`${label}：图片解码（含中文/emoji）`, decoded)
    await send('Target.closeTarget', { targetId: page.targetId }).catch(() => {})

    for (const p of ['popup.html', 'sidepanel.html']) {
      const c = await open(extId, prefix, p)
      const ready = await waitFor(c.sessionId, "!!document.querySelector('.app') && !!document.querySelector('.qr')")
      ok(`${label}：${p} 紧凑入口`, ready)
      await send('Target.closeTarget', { targetId: c.targetId }).catch(() => {})
    }
  }
} catch (e) {
  ok('真实扩展验证过程无异常', false, e instanceof Error ? e.message : String(e))
}
if (ws) ws.close()
proc.kill()
for (const dir of [dest, profile]) {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Chrome 可能仍占用目录 */ }
}
const failed = results.filter((r) => !r).length
console.log(`\n${failed ? `${failed} 项失败` : '全部通过'}：${results.length} 项断言`)
process.exit(failed ? 1 : 0)
