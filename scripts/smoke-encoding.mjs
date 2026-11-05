/** B8 编码工具 UI 冒烟：五个工具、方向切换、选项、错误处理、模块切换与紧凑模式 */
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

const common = String.raw`
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => results.push((pass ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + String(extra).slice(0, 90) : ''));
const q = (sel) => [...document.querySelectorAll(sel)];
const text = () => document.body.innerText;
const setValue = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const inputArea = () => q('.epane__area')[0];
const outputArea = () => q('.epane__area')[1];
const toolitem = (name) => q('.toolitem').find(b => b.textContent.includes(name));
const clickTitle = (title) => { const b = q('button').find(x => x.title === title); if (b) b.click(); };
const useSample = async () => { clickTitle('载入示例'); await sleep(240); };
const dirButton = (name) => q('.dirs button').find(b => b.textContent.includes(name));
const visible = (sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; };
const setInput = async (value) => { setValue(inputArea(), value); await sleep(260); };
`

const fullTests = String.raw`
  // 0) 切到编码模块
  await sleep(900);
  const encTab = q('.tabs .tab').find(b => b.textContent.trim() === '编码转换');
  ok('顶栏存在编码转换入口', !!encTab);
  encTab.click();
  await sleep(300);
  ok('编码模块已显示', visible('.enc') && !visible('.tool'));
  ok('五个工具齐全', q('.toolitem').length === 5, q('.toolitem').length);
  ok('初始载入 Base64 示例', !!inputArea() && inputArea().value.includes('研发好朋友'));

  // 1) Base64 编码 / 解码往返
  const sample = inputArea().value;
  const b64 = outputArea().value;
  ok('Base64 输出非空且不含中文', b64.length > 0 && !/[\u4e00-\u9fa5]/.test(b64), b64.slice(0, 24));
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  ok('Base64 输出可还原原文', decoded === sample);
  dirButton('解码').click();
  await sleep(200);
  await setInput(b64);
  ok('解码方向还原中文', outputArea().value === sample, outputArea().value.slice(0, 20));

  // 2) 选项：URL-safe / 折行
  dirButton('编码').click();
  await sleep(200);
  const urlSafeBox = q('.enc__bar input[type=checkbox]')[0];
  urlSafeBox.click();
  await sleep(200);
  ok('URL-safe 选项生效', !/[+/]/.test(outputArea().value.replace(/\n/g, '')), outputArea().value.slice(0, 24));
  const wrapSelect = q('.enc__bar select')[0];
  setValue(wrapSelect, '64');
  await sleep(200);
  ok('折行选项生效', outputArea().value.includes('\n'));
  urlSafeBox.click();
  setValue(wrapSelect, '0');
  await sleep(200);

  // 3) 非法 Base64 给出错误状态
  dirButton('解码').click();
  await sleep(150);
  await setInput('###');
  ok('非法 Base64 显示中文错误', !!document.querySelector('.enc__status--err'), document.querySelector('.enc__status')?.textContent);
  ok('错误时输出被清空', outputArea().value === '');

  // 4) URL 编码
  toolitem('URL 编码').click();
  await sleep(200);
  ok('切换工具保留用户已有输入', inputArea().value === '###');
  await useSample();
  ok('载入示例后输入为 URL', inputArea().value.includes('https://'));
  ok('URL 组件编码输出 %E7', outputArea().value.includes('%E7%A0%94'), outputArea().value.slice(0, 40));
  const modeSelect = q('.enc__bar select')[0];
  setValue(modeSelect, 'form');
  await sleep(220);
  ok('表单模式把空格转成 +', outputArea().value.includes('+'), outputArea().value.slice(0, 40));
  const encodedUrl = outputArea().value;
  dirButton('解码').click();
  await sleep(150);
  await setInput(encodedUrl);
  q('.enc__bar input[type=checkbox]')[0].click();
  await sleep(220);
  ok('+ 视为空格后可还原', outputArea().value.includes('研发 好朋友'), outputArea().value.slice(0, 40));

  // 5) Unicode 转义
  toolitem('Unicode').click();
  await sleep(200);
  await useSample();
  ok('Unicode 输出 \\u 转义', /\\u[0-9a-f]{4}/.test(outputArea().value), outputArea().value.slice(0, 40));
  const escaped = outputArea().value;
  dirButton('解码').click();
  await sleep(150);
  await setInput(escaped);
  ok('Unicode 解码还原中文与 emoji', outputArea().value.includes('研发好朋友') && outputArea().value.includes('🚀'), outputArea().value.slice(0, 40));

  // 6) HTML 实体
  toolitem('HTML').click();
  await sleep(200);
  await useSample();
  ok('HTML 输出含命名实体', outputArea().value.includes('&lt;div'), outputArea().value.slice(0, 40));
  const htmlMode = q('.enc__bar select')[0];
  setValue(htmlMode, 'nonAscii');
  await sleep(220);
  ok('非 ASCII 模式输出数字实体', outputArea().value.includes('&#x'), outputArea().value.slice(0, 60));
  const encodedHtml = outputArea().value;
  dirButton('解码').click();
  await sleep(150);
  await setInput(encodedHtml);
  ok('HTML 实体可完整还原', outputArea().value.includes('<div class="tip">'), outputArea().value.slice(0, 40));

  // 7) JWT 结构化解码
  toolitem('JWT').click();
  await sleep(200);
  await useSample();
  await sleep(120);
  ok('JWT 工具显示两张卡片', q('.jwt__card').length === 2, q('.jwt__card').length);
  ok('JWT 展示声明表', q('.jwt__claim').length > 3, q('.jwt__claim').length);
  ok('JWT 标注有效期', text().includes('过期时间') && text().includes('有效'), '');
  ok('JWT 明确不校验签名', q('.jwt__warn').some(n => n.textContent.includes('不校验签名')));
  ok('JWT 无编码方向', !document.querySelector('.dirs'));
  await setInput('abc');
  ok('非法 JWT 给出空状态提示', !!document.querySelector('.jwt__empty') && text().includes('无法解析 JWT'));

  // 8) 互换与模块切换保留状态
  toolitem('Base64').click();
  await sleep(200);
  await useSample();
  const beforeInput = inputArea().value;
  const beforeOutput = outputArea().value;
  clickTitle('结果放回输入并切换方向（Ctrl+Enter）');
  await sleep(240);
  ok('互换把结果放回输入', inputArea().value === beforeOutput, inputArea().value.slice(0, 20));
  const jsonTab = q('.tabs .tab').find(b => b.textContent.trim() === 'JSON 格式化');
  jsonTab.click();
  await sleep(320);
  ok('切回 JSON 模块', visible('.tool') && !visible('.enc'));
  ok('JSON 编辑器仍可用', q('.cm-editor').length === 2, q('.cm-editor').length);
  encTab.click();
  await sleep(320);
  ok('编码模块保留输入', inputArea().value === beforeOutput, inputArea().value.slice(0, 20));
  ok('切换工具后方向为解码', q('.dirs .is-active')[0]?.textContent.includes('解码'), '');
  ok('输入内容未丢', beforeInput.length > 0);
`

const compactTests = String.raw`
  await sleep(900);
  const toggle = q('button').find(b => b.title === '切换到编码转换');
  ok('紧凑模式有模块切换按钮', !!toggle);
  toggle.click();
  await sleep(300);
  ok('紧凑模式可进入编码模块', visible('.enc--compact'));
  ok('紧凑模式五个工具可点', q('.enc--compact .toolitem').length === 5);
  ok('紧凑模式双栏堆叠', q('.enc--compact .epane').length === 2);
  const back = q('button').find(b => b.title === '切换到 JSON 工具');
  ok('紧凑模式可返回 JSON', !!back);
  back.click();
  await sleep(300);
  ok('紧凑模式 JSON 编辑器可见', visible('.tool'));
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
  pre.textContent = 'ERROR ' + (e && e.stack || e && e.message);
  document.body.appendChild(pre);
});</script></body></html>`
  writeFileSync(resolve(dist, file), doc)
}

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
function run(file, width, height) {
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
        `--window-size=${width},${height}`,
        '--virtual-time-budget=16000',
        '--dump-dom',
        'file:///' + resolve(dist, file).replace(/\\/g, '/'),
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 40, stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (error) {
    dom = error.stdout || ''
  }
  const match = dom.match(/<pre id="smoke-result">([\s\S]*?)<\/pre>/)
  if (!match) return 'FAIL 未拿到 ' + file + ' 的测试结果'
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
}

makePage('smoke-encoding.html', 'full', fullTests)
makePage('smoke-encoding-compact.html', 'sidepanel', compactTests)

const report = [run('smoke-encoding.html', 1280, 800), run('smoke-encoding-compact.html', 380, 760)].join('\n')
console.log(report)
const fails = report.split('\n').filter((line) => line.startsWith('FAIL') || line.startsWith('ERROR')).length
console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}`)
process.exit(fails === 0 ? 0 : 1)
