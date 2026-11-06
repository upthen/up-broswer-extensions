/**
 * 二维码解码：jsQR 只接收 RGBA 像素，不接触文件 / 网络 / DOM。
 * 上游（UI）负责把图片画进 canvas 并取 ImageData；这里也方便在 Node 里做生成→解码往返单测。
 */
import jsQR from 'jsqr'
import { decodeFailure } from './types'
import type { QrDecodeResult } from './types'

function tryUtf8(bytes: number[]): string | null {
  if (!bytes.length) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
  } catch {
    return null
  }
}

/** 解码 RGBA 像素数组；自动尝试反色二维码，UTF-8 字节优先还原，中文不会乱码 */
export function decodeQr(data: Uint8ClampedArray, width: number, height: number): QrDecodeResult {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return decodeFailure('图片数据不完整，请换一张图片重试')
  }

  try {
    const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!found) {
      return decodeFailure('未识别到二维码：请确认图片清晰、二维码完整且在画面内，避免严重倾斜或反光')
    }

    const bytes = found.binaryData ?? []
    const utf8 = tryUtf8(bytes)
    const text = utf8 ?? found.data
    const chunks = Array.isArray(found.chunks) ? found.chunks.length : 0

    return {
      ok: true,
      text,
      note: `识别成功 · 版本 ${found.version} · ${bytes.length} 字节 · ${chunks} 段数据`,
      warning: utf8 && utf8 !== found.data ? '二维码未声明字符集，已按 UTF-8 还原原始字节' : '',
      error: '',
      version: found.version,
      bytes: bytes.length,
      chunks,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return decodeFailure(`二维码解析失败：${message}。可能使用了非 UTF-8 编码或图片已损坏`)
  }
}
