import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const script = readFileSync(resolve(root, 'scripts/make-icons.mjs'), 'utf8')
const SIZES = [16, 32, 48, 128] as const

type Pixel = { r: number; g: number; b: number; a: number }

/** 解析本仓库自制的 PNG（RGBA8 / filter none），不依赖任何图像库 */
function readIcon(size: (typeof SIZES)[number]) {
  const file = resolve(root, `public/icons/icon${size}.png`)
  expect(existsSync(file)).toBe(true)
  const buf = readFileSync(file)
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

  let offset = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + len
  }
  expect([width, height]).toEqual([size, size])
  expect([depth, colorType]).toEqual([8, 6]) // 8bit RGBA

  const raw = inflateSync(Buffer.concat(idat))
  const stride = size * 4 + 1
  expect(raw.length).toBe(stride * size)
  for (let y = 0; y < size; y += 1) expect(raw[y * stride]).toBe(0) // filter: none

  return (x: number, y: number): Pixel => {
    const i = y * stride + 1 + x * 4
    return { r: raw[i], g: raw[i + 1], b: raw[i + 2], a: raw[i + 3] }
  }
}

const isWhite = (p: Pixel) => p.a > 200 && p.r > 235 && p.g > 235 && p.b > 235
const isBlue = (p: Pixel) => p.a > 200 && p.b > 140 && p.b - p.r > 60 && p.b - p.g > 40

describe('T-39 · 扩展图标换成便签本品牌图形（不再是钥匙）', () => {
  it('生成脚本描述便签图形，不含旧钥匙绘制逻辑', () => {
    expect(script).toMatch(/便签/)
    expect(script).toMatch(/59,\s*91,\s*219/) // 品牌色 #3b5bdb
    expect(script).not.toMatch(/钥匙|\bshaft\b|\btooth[12]?\b|\bring\b/)
  })

  it('四个尺寸都是合法的 RGBA PNG，四角透明、中心不透明', () => {
    for (const size of SIZES) {
      const px = readIcon(size)
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
        expect(px(x, y).a).toBeLessThan(128)
      }
      expect(px(Math.floor(size / 2), Math.floor(size / 2)).a).toBeGreaterThan(200)
    }
  })

  it('底色是品牌蓝，不是旧的 #2563eb 纯色块', () => {
    const px = readIcon(128)
    const p = px(Math.round(128 * 0.08), Math.round(128 * 0.5))
    expect(isBlue(p)).toBe(true)
  })

  it('画面主体是一张白色便签纸（旧钥匙图标该区域几乎全是蓝底）', () => {
    for (const size of SIZES) {
      const px = readIcon(size)
      let white = 0
      let total = 0
      for (let y = Math.round(size * 0.25); y <= Math.round(size * 0.75); y += 1) {
        for (let x = Math.round(size * 0.3); x <= Math.round(size * 0.7); x += 1) {
          total += 1
          if (isWhite(px(x, y))) white += 1
        }
      }
      expect(white / total).toBeGreaterThan(0.4)
    }
  })

  it('大尺寸还画出便签纸上的水平文字线与右下折角层次', () => {
    const px = readIcon(128)
    // 白纸区域内应有一段连续 ≥ 0.2 宽度的品牌蓝横线（旧图标只有零散的蓝色块）
    let longestRun = 0
    for (let y = Math.round(128 * 0.29); y <= Math.round(128 * 0.62); y += 1) {
      let run = 0
      for (let x = Math.round(128 * 0.28); x <= Math.round(128 * 0.64); x += 1) {
        if (isBlue(px(x, y))) run += 1
        else {
          longestRun = Math.max(longestRun, run)
          run = 0
        }
      }
      longestRun = Math.max(longestRun, run)
    }
    expect(longestRun / 128).toBeGreaterThan(0.2)
    // 右下角折角是浅蓝灰纸背，不是纯白也不是蓝底
    const fold = px(Math.round(128 * 0.68), Math.round(128 * 0.69))
    expect(fold.a).toBeGreaterThan(200)
    expect(fold.r).toBeGreaterThan(180)
    expect(fold.g).toBeGreaterThan(180)
    expect(isWhite(fold)).toBe(false)
    expect(isBlue(fold)).toBe(false)
  })
})
