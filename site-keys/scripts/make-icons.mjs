// 零依赖生成 4 个 PNG 图标：品牌蓝圆角方底 + 白色便签纸（后叠一张淡黄便签）+ 蓝色文字横线。
// 与界面里的 i-logo / --accent / --highlight 同一套视觉，替换掉旧账号库时代的旧图形。
// 不引 sharp / canvas，直接用 node:zlib 写最小 PNG；4x4 超采样做边缘抗锯齿，保证 16px 也清晰。
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')

const BRAND = [59, 91, 219] // #3b5bdb，--accent
const BG_TOP = [74, 104, 232]
const BG_BOTTOM = [47, 76, 196] // #2f4cc4，--accent-hover
const PAPER = [255, 255, 255]
const BACK_PAPER = [255, 242, 184] // #fff2b8，--highlight，露出的一角
const FOLD = [226, 233, 250] // 右下折起的纸背
const BG_RADIUS = 0.22
const SS = 4 // 每像素 4x4 采样

// 小尺寸走极简形态：一张白纸 + 两道粗横线；大尺寸再叠便签、折角与三条文字线。
const PAPER_FULL = [0.21, 0.2, 0.71, 0.72, 0.055]
const PAPER_SMALL = [0.18, 0.18, 0.82, 0.82, 0.12]
const LINES_FULL = [
  [0.29, 0.62, 0.335],
  [0.29, 0.62, 0.455],
  [0.29, 0.49, 0.575],
]
const LINES_SMALL = [
  [0.29, 0.71, 0.4, 0.045],
  [0.29, 0.71, 0.6, 0.045],
]

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function png(size, rgba) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

function inRound(nx, ny, x0, y0, x1, y1, r) {
  const cx = clamp(nx, x0 + r, x1 - r)
  const cy = clamp(ny, y0 + r, y1 - r)
  return Math.hypot(nx - cx, ny - cy) <= r
}

/** 归一化坐标 → 该采样点的颜色；逐层覆盖：背景 → 后叠便签 → 主便签 → 折角 → 文字线 */
function shade(nx, ny, compact) {
  if (!inRound(nx, ny, 0, 0, 1, 1, BG_RADIUS)) return [0, 0, 0, 0]

  const t = clamp(nx * 0.55 + ny * 0.45, 0, 1)
  let c = BG_TOP.map((v, i) => v + (BG_BOTTOM[i] - v) * t)

  if (compact) {
    const [x0, y0, x1, y1, r] = PAPER_SMALL
    const onPaper = inRound(nx, ny, x0, y0, x1, y1, r)
    if (onPaper) c = PAPER
    if (onPaper) {
      for (const [lx0, lx1, ly, half] of LINES_SMALL) {
        if (nx >= lx0 && nx <= lx1 && Math.abs(ny - ly) <= half) c = BRAND
      }
    }
  } else {
    // 后叠的一张淡黄便签，从主便签的右侧与下沿露出 L 形一角
    if (inRound(nx, ny, 0.3, 0.28, 0.79, 0.8, 0.055)) c = BACK_PAPER
    const [x0, y0, x1, y1, r] = PAPER_FULL
    const onPaper = inRound(nx, ny, x0, y0, x1, y1, r)
    if (onPaper) c = PAPER
    // 右下折角：纸内 x + y >= 1.28 的三角区
    if (onPaper && nx >= 0.56 && nx + ny >= 1.28) c = FOLD
    if (onPaper) {
      for (const [lx0, lx1, ly] of LINES_FULL) {
        if (nx >= lx0 && nx <= lx1 && Math.abs(ny - ly) <= 0.022) c = BRAND
      }
    }
  }
  return [c[0], c[1], c[2], 255]
}

/** 超采样：按 alpha 加权平均颜色，圆角与斜边不会有黑边或锯齿 */
function render(size, compact) {
  const buf = Buffer.alloc(size * size * 4)
  const samples = SS * SS
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const nx = (x + (sx + 0.5) / SS) / size
          const ny = (y + (sy + 0.5) / SS) / size
          const [r, g, b, a] = shade(nx, ny, compact)
          const w = a / 255
          sr += r * w
          sg += g * w
          sb += b * w
          sa += w
        }
      }
      const i = (y * size + x) * 4
      if (sa === 0) continue // 全透明
      buf[i] = Math.round(sr / sa)
      buf[i + 1] = Math.round(sg / sa)
      buf[i + 2] = Math.round(sb / sa)
      buf[i + 3] = Math.round((sa / samples) * 255)
    }
  }
  return buf
}

const SIZES = [16, 32, 48, 128]

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  writeFileSync(resolve(OUT, `icon${size}.png`), png(size, render(size, size <= 32)))
}

// 预览页自包含：把四档图标内联成 data URI，离线打开与内置静态预览都能显示。
// 按 data-icon 定位并整段替换 src，重复执行是幂等的，预览页不会残留上一版图标。
const PREVIEW = resolve(dirname(fileURLToPath(import.meta.url)), '../design/icon-preview.html')
if (existsSync(PREVIEW)) {
  let html = readFileSync(PREVIEW, 'utf8')
  for (const size of SIZES) {
    const data = readFileSync(resolve(OUT, `icon${size}.png`)).toString('base64')
    const pattern = new RegExp(`(<img[^>]*data-icon="${size}"[^>]*src=")[^"]*(")`, 'g')
    html = html.replace(pattern, (_match, open, close) => `${open}data:image/png;base64,${data}${close}`)
  }
  writeFileSync(PREVIEW, html)
}

process.stdout.write(
  `生成便签本图标：${SIZES.map((s) => `icon${s}.png`).join(', ')}；预览页图标已内联\n`,
)
