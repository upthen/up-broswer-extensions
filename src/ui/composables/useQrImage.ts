/**
 * 二维码模块的浏览器侧胶水层：图片文件 → RGBA 像素 → core 解码；
 * 以及矩阵 → canvas → PNG / 示例图片。core 保持零 DOM，方便单测。
 */
import { QR_DEFAULTS, decodeFailure, decodeQr, normalizeColor } from '@/core/qrcode'
import type { QrCode, QrDecodeResult, QrOptions } from '@/core/qrcode'

export interface QrImageInfo {
  name: string
  width: number
  height: number
  /** object URL，调用方在替换 / 卸载时负责 revoke */
  url: string
}

export interface QrFileOutcome {
  result: QrDecodeResult
  info: QrImageInfo | null
}

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_SIDE = 1600
const MIN_SIDE = 240

async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; close: () => void; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // 某些环境对 createImageBitmap 的 File 入参支持不全，回退 <img>
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  await image.decode()
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  }
}

/** 解码本地图片文件：点击选择 / 拖拽 / 粘贴 / 示例图片都走这条链路 */
export async function decodeQrFile(file: File): Promise<QrFileOutcome> {
  if (!file.type.startsWith('image/') || /svg/i.test(file.type)) {
    return { result: decodeFailure('请选择 PNG / JPG / WebP 等位图图片，SVG 暂不支持'), info: null }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { result: decodeFailure('图片超过 12 MB，请压缩后重试'), info: null }
  }

  let loaded: Awaited<ReturnType<typeof loadBitmap>> | null = null
  try {
    loaded = await loadBitmap(file)
    const longest = Math.max(loaded.width, loaded.height)
    let scale = 1
    if (longest > MAX_SIDE) scale = MAX_SIDE / longest
    else if (longest < MIN_SIDE) scale = Math.min(4, MIN_SIDE / longest)

    const width = Math.max(1, Math.round(loaded.width * scale))
    const height = Math.max(1, Math.round(loaded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { result: decodeFailure('浏览器不支持 Canvas 2D，无法读取图片'), info: null }
    ctx.drawImage(loaded.source, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height)

    return {
      result: decodeQr(pixels.data, width, height),
      info: { name: file.name, width: loaded.width, height: loaded.height, url: URL.createObjectURL(file) },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { result: decodeFailure(`图片读取失败：${message}`), info: null }
  } finally {
    loaded?.close()
  }
}

/** 把模块矩阵画到指定边长的 canvas，用于下载 PNG 与生成示例图片 */
export function drawQrToCanvas(code: QrCode, options: QrOptions, pixelSize: number): HTMLCanvasElement {
  const size = Math.max(64, Math.round(pixelSize))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = normalizeColor(options.light, QR_DEFAULTS.light)
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = normalizeColor(options.dark, QR_DEFAULTS.dark)

  const cell = size / code.total
  for (let row = 0; row < code.size; row += 1) {
    for (let col = 0; col < code.size; col += 1) {
      if (!code.modules[row * code.size + col]) continue
      const x = (col + code.margin) * cell
      const y = (row + code.margin) * cell
      const x1 = Math.round(x)
      const y1 = Math.round(y)
      const w = Math.round(x + cell) - x1
      const h = Math.round(y + cell) - y1
      if (w > 0 && h > 0) ctx.fillRect(x1, y1, w, h)
    }
  }
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png')
  })
}

/** 生成一张真实的 PNG 图片文件，让「载入示例二维码」走完整的图片解码流程 */
export async function makeQrFile(code: QrCode, options: QrOptions, size = 512): Promise<File> {
  const blob = await canvasToBlob(drawQrToCanvas(code, options, size))
  return new File([blob], 'devbuddy-qr-sample.png', { type: 'image/png' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
