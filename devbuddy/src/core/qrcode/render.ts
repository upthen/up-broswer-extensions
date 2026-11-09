/** 二维码渲染：SVG 字符串与 RGBA 像素矩阵（纯函数，供导出 / 单测 / 示例图片复用） */
import { QR_DEFAULTS } from './types'
import type { QrCode, QrOptions } from './types'

export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 只接受 #rgb / #rrggbb，杜绝把任意字符串拼进 SVG 造成注入 */
export function normalizeColor(input: string | undefined, fallback: string): string {
  const value = (input ?? '').trim()
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  return fallback
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeColor(hex, '#000000')
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

/** 同一行里连续的深色模块合并成一个矩形，SVG 体积更小 */
export function qrPath(code: QrCode): string {
  const parts: string[] = []
  const { size, margin, modules } = code
  for (let row = 0; row < size; row += 1) {
    let col = 0
    while (col < size) {
      if (!modules[row * size + col]) {
        col += 1
        continue
      }
      let len = 1
      while (col + len < size && modules[row * size + col + len]) len += 1
      parts.push(`M${col + margin} ${row + margin}h${len}v1h-${len}z`)
      col += len
    }
  }
  return parts.join('')
}

/** 生成可直接下载 / 预览的 SVG 文本；pixelSize 只影响 width/height，viewBox 始终按模块计 */
export function qrSvg(code: QrCode, options: QrOptions = {}, pixelSize = code.total): string {
  const dark = normalizeColor(options.dark, QR_DEFAULTS.dark)
  const light = normalizeColor(options.light, QR_DEFAULTS.light)
  const side = Math.max(1, Math.round(pixelSize))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${code.total} ${code.total}" shape-rendering="crispEdges">`,
    `<rect width="${code.total}" height="${code.total}" fill="${light}"/>`,
    `<path d="${qrPath(code)}" fill="${dark}"/>`,
    '</svg>',
  ].join('')
}

/** 矩阵 → RGBA 像素（每模块 scale×scale），用于 PNG 导出、示例图片与解码单测 */
export function matrixToRgba(code: QrCode, scale = 4, options: QrOptions = {}): RgbaImage {
  const step = Math.max(1, Math.trunc(scale))
  const width = code.total * step
  const height = width
  const data = new Uint8ClampedArray(width * height * 4)
  const [lr, lg, lb] = hexToRgb(normalizeColor(options.light, QR_DEFAULTS.light))
  const [dr, dg, db] = hexToRgb(normalizeColor(options.dark, QR_DEFAULTS.dark))

  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = lr
    data[i * 4 + 1] = lg
    data[i * 4 + 2] = lb
    data[i * 4 + 3] = 255
  }

  for (let row = 0; row < code.size; row += 1) {
    for (let col = 0; col < code.size; col += 1) {
      if (!code.modules[row * code.size + col]) continue
      const x0 = (col + code.margin) * step
      const y0 = (row + code.margin) * step
      for (let dy = 0; dy < step; dy += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const offset = ((y0 + dy) * width + x0 + dx) * 4
          data[offset] = dr
          data[offset + 1] = dg
          data[offset + 2] = db
        }
      }
    }
  }
  return { data, width, height }
}
