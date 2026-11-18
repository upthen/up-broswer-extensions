// =============================================================================
// shot.mjs —— history-by-domain/design 静态设计稿截图脚本（零依赖）
// -----------------------------------------------------------------------------
// 用 Node 22 内置的全局 fetch + WebSocket 连接 Chrome headless 的 CDP，
// 真实渲染 mockup.html 后：
//   1) 整页长图            -> design/preview.png
//   2) 按 section 裁图      -> design/shots/<data-shot>.png（全部 10 张）
// 脚本自身负责启动并在结束时关闭 headless Chrome，不留后台进程。
// 用法：node shot.mjs   （可选：node shot.mjs "C:/path/to/chrome.exe"）
// 注意：mockup.html 本身零脚本；本文件是独立的截图工具，不属于设计稿。
// =============================================================================
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCKUP = path.join(HERE, 'mockup.html');
const SHOTS_DIR = path.join(HERE, 'shots');
const PREVIEW = path.join(HERE, 'preview.png');
const CHROME = process.argv[2] || process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEW_W = 1480;               // 视口宽：1400 画板 + 左右各 40px 留白
const BASE_H = 1000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// PNG IHDR 读取像素尺寸
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('不是合法 PNG');
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (let p = 9222; p <= 9242; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('9222–9242 端口都不可用');
}

// ---- 1. 启动 headless Chrome -------------------------------------------------
fs.mkdirSync(SHOTS_DIR, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbd-shot-'));
const port = await pickPort();
console.log(`[shot] Chrome : ${CHROME}`);
console.log(`[shot] 端口   : ${port}   临时目录: ${userDataDir}`);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  `--window-size=${VIEW_W},${BASE_H}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws = null;
try {
  // ---- 2. 等待 CDP 就绪并拿到 page target -----------------------------------
  let pageWs = null;
  for (let i = 0; i < 100 && !pageWs; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) pageWs = page.webSocketDebuggerUrl;
    } catch { /* 尚未就绪 */ }
    if (!pageWs) await delay(150);
  }
  if (!pageWs) throw new Error(`CDP (端口 ${port}) 未就绪或没有 page target`);

  // ---- 3. 建立 WebSocket + 极简 CDP 客户端 ----------------------------------
  ws = new WebSocket(pageWs);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败：' + (e?.message || ''))), { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
    else resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW_W, height: BASE_H, deviceScaleFactor: 1, mobile: false,
  });

  // ---- 4. 导航到设计稿 ------------------------------------------------------
  const fileUrl = pathToFileURL(MOCKUP).href;
  console.log(`[shot] 导航   : ${fileUrl}`);
  await send('Page.navigate', { url: fileUrl });

  // 等待加载完成（无外部资源，通常很快）
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', {
      expression: 'document.readyState', returnByValue: true,
    });
    if (r.result?.value === 'complete') break;
    await delay(150);
  }
  await delay(500); // 等字体 / 布局稳定

  const measureExpr = `(() => {
    window.scrollTo(0, 0);
    const secs = [...document.querySelectorAll('section.board')];
    return {
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      sections: secs.map((s) => {
        const r = s.getBoundingClientRect();
        return {
          id: s.id, shot: s.dataset.shot,
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      }),
    };
  })()`;
  const measure = async () => {
    const r = await send('Runtime.evaluate', { expression: measureExpr, returnByValue: true });
    return r.result.value;
  };

  let info = await measure();
  if (!info.sections.length) throw new Error('没有找到 section.board');

  // 把视口高度撑到整页，使 clip 坐标既等于文档坐标也等于视口坐标（最稳妥）
  const fullH = info.scrollHeight + 80;
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW_W, height: fullH, deviceScaleFactor: 1, mobile: false,
  });
  await delay(300);
  info = await measure();
  console.log(`[shot] 整页   : ${info.scrollWidth} x ${info.scrollHeight}（视口高 ${fullH}）`);
  console.log(`[shot] section: ${info.sections.length} 个`);

  // 相邻画板不重叠自检
  let overlap = 0;
  for (let i = 1; i < info.sections.length; i++) {
    const prev = info.sections[i - 1], cur = info.sections[i];
    if (prev.y + prev.h > cur.y) overlap++;
  }
  console.log(`[shot] 重叠检查: ${overlap === 0 ? '通过（无重叠 / 无裁切）' : overlap + ' 处重叠'}`);

  // ---- 5. 整页长图 ----------------------------------------------------------
  const fullShot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, fromSurface: true,
  });
  const fullBuf = Buffer.from(fullShot.data, 'base64');
  fs.writeFileSync(PREVIEW, fullBuf);
  const ps = pngSize(fullBuf);
  console.log(`[shot] preview.png : ${ps.w} x ${ps.h}`);

  // ---- 6. 按 section 裁图（全部 10 张） -------------------------------------
  for (const s of info.sections) {
    const clip = { x: s.x, y: s.y, width: s.w, height: s.h, scale: 1 };
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true, clip,
    });
    const buf = Buffer.from(shot.data, 'base64');
    const out = path.join(SHOTS_DIR, `${s.shot}.png`);
    fs.writeFileSync(out, buf);
    const sz = pngSize(buf);
    console.log(`[shot] shots/${s.shot}.png : ${sz.w} x ${sz.h}  (${s.id})`);
  }

  console.log('[shot] 完成：1 张整页长图 + ' + info.sections.length + ' 张分状态裁图');
} finally {
  // ---- 7. 关闭 headless Chrome，清理临时目录 --------------------------------
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  if (chrome && chrome.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* 进程可能已退出 */ }
  }
  await delay(500);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log('[shot] 已关闭 headless Chrome 并清理临时目录');
}
