/**
 * 二维码生成：把文本按 UTF-8 字节写入 Byte 模式，得到纯布尔模块矩阵。
 *
 * 说明：qrcode-generator 的默认 stringToBytes 是 Latin-1（逐字符取低 8 位），
 * 所以这里先把 TextEncoder 产出的 UTF-8 字节拼成「每字符 ≤ 0xff」的字符串再交给它，
 * 既避免修改库的全局状态，也能让中文 / emoji 正确写入二维码。
 * 生成的二维码不带 ECI 段，主流扫码器与 jsQR 会按 UTF-8 解读。
 */
import qrcode from 'qrcode-generator'
import { QR_CAPACITY, QR_DEFAULTS, QR_LEVELS, encodeFailure } from './types'
import type { QrCode, QrEncodeResult, QrErrorLevel, QrOptions } from './types'

/** UTF-8 字节 → 低字节字符串（qrcode-generator 的默认字节转换可无损读回） */
function toByteString(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 1) parts.push(String.fromCharCode(bytes[i]))
  return parts.join('')
}

function levelMeta(level: QrErrorLevel) {
  return QR_LEVELS.find((item) => item.id === level) ?? QR_LEVELS[1]
}

/** 把库抛出的英文异常翻译成可操作的中文提示 */
function translateError(message: string): string {
  if (/overflow|too long|length/i.test(message)) {
    return '内容过长，当前版本装不下：请缩短内容、降低纠错等级，或把版本设为「自动」'
  }
  if (/type number|version/i.test(message)) {
    return '版本号不合法：请使用 1–40 之间的版本，或设为「自动」'
  }
  return `二维码生成失败：${message}`
}

export function encodeQr(text: string, options: QrOptions = {}): QrEncodeResult {
  if (!text) return encodeFailure('请输入要生成二维码的内容')

  const level: QrErrorLevel = options.level ?? QR_DEFAULTS.level
  const version = options.version ?? QR_DEFAULTS.version
  const margin = Math.max(0, Math.min(16, Math.trunc(options.margin ?? QR_DEFAULTS.margin)))
  const bytes = new TextEncoder().encode(text)

  if (version !== 0 && (!Number.isInteger(version) || version < 1 || version > 40)) {
    return encodeFailure('版本号不合法：请使用 1–40 之间的版本，或设为「自动」')
  }

  const capacity = QR_CAPACITY[level]
  if (bytes.length > capacity) {
    return encodeFailure(
      `内容过长：当前 ${bytes.length} 字节，纠错等级 ${level} 最多可容纳 ${capacity} 字节。请缩短内容或降低纠错等级`,
    )
  }

  try {
    const qr = qrcode(version as Parameters<typeof qrcode>[0], level)
    qr.addData(toByteString(bytes), 'Byte')
    qr.make()

    const size = qr.getModuleCount()
    const modules: boolean[] = new Array(size * size)
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        modules[row * size + col] = qr.isDark(row, col)
      }
    }

    const actualVersion = (size - 17) / 4
    const code: QrCode = {
      modules,
      size,
      version: actualVersion,
      level,
      text,
      bytes: bytes.length,
      margin,
      total: size + margin * 2,
    }

    const warning =
      margin < 4
        ? '静区小于 4 模块，部分扫码器可能无法识别'
        : bytes.length > capacity * 0.85
          ? '内容接近容量上限，扫码难度会增加'
          : ''

    return {
      ok: true,
      code,
      note: `版本 ${actualVersion} · ${size}×${size} 模块 · ${bytes.length} 字节 · 容错 ${level}（${levelMeta(level).rate}）`,
      warning,
      error: '',
    }
  } catch (error) {
    return encodeFailure(translateError(error instanceof Error ? error.message : String(error)))
  }
}
