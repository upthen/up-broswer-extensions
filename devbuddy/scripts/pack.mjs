/**
 * 生成可分发安装包（零新增依赖，Node 内置模块即可）：
 *   release/DevBuddy-<ver>-chrome-extension.zip   解压即用（推荐）
 *   release/DevBuddy-<ver>.crx                    CRX3 签名包（企业/留档）
 *
 * 前置：npm run build（vite 会清空 dist 并生成根目录转发版 manifest.json）。
 * 用法：node scripts/pack.mjs [--no-crx]
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const release = join(root, 'release')
const stage = join(release, '.stage', 'DevBuddy')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const folderName = `DevBuddy-${version}`
const zipPath = join(release, `DevBuddy-${version}-chrome-extension.zip`)
const crxPath = join(release, `DevBuddy-${version}.crx`)
const withCrx = !process.argv.includes('--no-crx')

/* ---------- 前置检查：构建产物 + 两份清单 ---------- */
for (const p of [join(dist, 'manifest.json'), join(root, 'manifest.json'), join(root, 'docs/INSTALL.txt')]) {
  if (!existsSync(p)) {
    console.error(`缺少 ${p}\n请先执行 npm run build（构建会生成根目录转发版 manifest.json）。`)
    process.exit(1)
  }
}
const distManifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
if (distManifest.version !== version || rootManifest.version !== version) {
  console.error(`版本号不一致：package=${version} dist=${distManifest.version} root=${rootManifest.version}`)
  process.exit(1)
}
if (!String(rootManifest.action?.default_popup || '').startsWith('dist/')) {
  console.error('根目录 manifest.json 不是转发版（入口没有 dist/ 前缀），请先执行 npm run build。')
  process.exit(1)
}

/** dist 里由冒烟/截图脚本生成的临时文件不进安装包 */
const SKIP = [/^smoke.*\.html$/, /^\./, /\.map$/, /\.log$/]

function collect(dir, base = '', out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.some((re) => re.test(ent.name))) continue
    const abs = join(dir, ent.name)
    const rel = base ? `${base}/${ent.name}` : ent.name
    if (ent.isDirectory()) collect(abs, rel, out)
    else if (ent.isFile()) out.push({ abs, rel })
  }
  return out
}

/* ---------- 组装 staging 目录 ---------- */
rmSync(join(release, '.stage'), { recursive: true, force: true })
mkdirSync(join(stage, 'dist'), { recursive: true })
const builtFiles = collect(dist)
for (const f of builtFiles) {
  const dest = join(stage, 'dist', f.rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(f.abs, dest)
}
copyFileSync(join(root, 'manifest.json'), join(stage, 'manifest.json'))
writeFileSync(
  join(stage, 'INSTALL.txt'),
  '\uFEFF' + readFileSync(join(root, 'docs/INSTALL.txt'), 'utf8').replaceAll('{{VERSION}}', version),
  'utf8',
)

/* ---------- 校验：清单引用的路径、HTML 引用的 assets 全部存在 ---------- */
function pathsIn(m) {
  const out = []
  const push = (v) => typeof v === 'string' && out.push(v)
  Object.values(m.icons || {}).forEach(push)
  Object.values(m.action?.default_icon || {}).forEach(push)
  push(m.action?.default_popup)
  push(m.side_panel?.default_path)
  push(m.background?.service_worker)
  push(m.options_ui?.page)
  push(m.options_page)
  for (const war of m.web_accessible_resources || []) (war.resources || []).forEach(push)
  return out.filter((p) => !p.startsWith('http') && !p.startsWith('chrome-extension:'))
}
const missing = []
for (const [label, m] of [['根目录清单', rootManifest], ['dist 清单', distManifest]]) {
  const base = label === '根目录清单' ? stage : join(stage, 'dist')
  for (const p of pathsIn(m)) {
    const abs = join(base, p.replace(/^\.?\//, ''))
    if (!existsSync(abs)) missing.push(`${label} → ${p}`)
  }
}
for (const page of ['index.html', 'popup.html', 'sidepanel.html']) {
  const html = readFileSync(join(stage, 'dist', page), 'utf8')
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const p = match[1].replace(/^\.\//, '')
    if (p.startsWith('http') || p.startsWith('data:') || p.startsWith('#')) continue
    if (!existsSync(join(stage, 'dist', p))) missing.push(`${page} → ${p}`)
  }
}
if (missing.length) {
  console.error('安装包缺少以下被引用文件：\n  ' + missing.join('\n  '))
  process.exit(1)
}

/* ---------- ZIP（deflate，UTF-8 文件名标记，零外部依赖） ---------- */
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function dosStamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}
function makeZip(entries) {
  const { time, date } = dosStamp(new Date())
  const body = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = readFileSync(e.abs)
    const data = deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // version needed
    lh.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    lh.writeUInt16LE(8, 8) // deflate
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(name.length, 26)
    body.push(lh, name, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(0x0314, 4) // made by: Unix / zip 2.0
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(0x81a40000, 38) // 0100644
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += lh.length + name.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...body, cdBuf, eocd])
}
const zipEntries = collect(stage).map((f) => ({ abs: f.abs, name: `${folderName}/${f.rel}` }))
mkdirSync(release, { recursive: true })
const zipBuf = makeZip(zipEntries)
writeFileSync(zipPath, zipBuf)

/* ---------- CRX3（调用本机 Chrome 打包，失败不影响 zip） ---------- */
let crxOk = false
if (withCrx) {
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  if (!existsSync(chrome)) {
    console.log('跳过 CRX：未找到 Chrome（可设置 CHROME_PATH 指定路径）')
  } else {
    const keyDir = join(release, '.keys')
    mkdirSync(keyDir, { recursive: true })
    const key = join(keyDir, 'devbuddy.pem')
    const args = [
      '--no-first-run',
      '--no-default-browser-check',
      `--pack-extension=${stage}`,
    ]
    if (existsSync(key)) args.push(`--pack-extension-key=${key}`)
    const r = spawnSync(chrome, args, { encoding: 'utf8', timeout: 180000, windowsHide: true })
    const madeCrx = `${stage}.crx`
    const madePem = `${stage}.pem`
    if (existsSync(madePem)) renameSync(madePem, key) // 固定私钥 → 扩展 ID 稳定
    if (existsSync(madeCrx)) {
      rmSync(crxPath, { force: true })
      renameSync(madeCrx, crxPath)
      crxOk = true
    } else {
      console.log('跳过 CRX：Chrome 未产出 .crx', (r.stdout || '').trim(), (r.stderr || '').trim())
    }
  }
}

/* ---------- 清理 staging 并输出结果 ---------- */
rmSync(join(release, '.stage'), { recursive: true, force: true })
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const kb = (p) => `${(statSync(p).size / 1024).toFixed(1)} KB`
console.log(`\n安装包已生成（v${version}，${zipEntries.length} 个文件）`)
console.log(`  ${zipPath}`)
console.log(`    ${kb(zipPath)}  sha256:${sha(zipPath)}…`)
if (crxOk) {
  console.log(`  ${crxPath}`)
  console.log(`    ${kb(crxPath)}  sha256:${sha(crxPath)}…`)
}
console.log('\nzip 解压后选文件夹本身或 dist/ 都能加载；crx 用于企业部署，个人安装请用 zip。')
