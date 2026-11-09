/** Base64 / Base64URL：手写字节级实现，避免 btoa 的 Latin-1 限制，且可跑在 Node 单测里 */

import { boolOpt, failure, numOpt, strOpt, success } from './types'
import type { EncodeResult, EncodingOptions } from './types'

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export interface Base64CodecOptions {
  urlSafe?: boolean
  padding?: boolean
  wrap?: number
  charset?: 'utf8' | 'latin1'
  strict?: boolean
}

/** 字节 → Base64 文本（URL-safe 与填充策略可分别控制） */
export function bytesToBase64(bytes: Uint8Array, urlSafe = false, padding = true): string {
  const table = urlSafe ? URL : STD
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += table[(n >>> 18) & 63]
    out += table[(n >>> 12) & 63]
    out += b === undefined ? (padding ? '=' : '') : table[(n >>> 6) & 63]
    out += c === undefined ? (padding ? '=' : '') : table[n & 63]
  }
  return out
}

/** Base64 文本 → 字节；自动识别 URL-safe、折行、data URI、缺失的填充 */
export function base64ToBytes(raw: string, strict = false): { bytes: Uint8Array | null; error: string; urlSafe: boolean } {
  let text = raw.trim()
  const dataUri = /^data:[^,]*;base64,/i.exec(text)
  if (dataUri) text = text.slice(dataUri[0].length)

  // 折行、空格在非严格模式下都视作可忽略；严格模式下只允许合法字符
  const compact = strict ? text : text.replace(/\s+/g, '')
  const urlSafe = /[-_]/.test(compact)
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')

  if (!normalized) return { bytes: new Uint8Array(0), error: '', urlSafe }

  const body = normalized.replace(/=+$/, '')
  const padCount = normalized.length - body.length
  if (padCount > 2) {
    return { bytes: null, error: '末尾的 = 填充最多只能有 2 个', urlSafe }
  }
  if (strict && padCount === 0 && normalized.length % 4 !== 0) {
    return { bytes: null, error: '严格模式下 Base64 长度必须是 4 的倍数（可关闭严格模式自动补填充）', urlSafe }
  }
  if (body.length % 4 === 1) {
    return { bytes: null, error: 'Base64 长度不合法（剩余 1 个字符无法解码）', urlSafe }
  }

  const invalid = /[^A-Za-z0-9+/]/.exec(body)
  if (invalid) {
    return {
      bytes: null,
      error: `第 ${invalid.index + 1} 个字符「${invalid[0]}」不是合法的 Base64 字符`,
      urlSafe,
    }
  }

  // 末尾不足 6 bit 的位必须补零，否则是伪造的编码
  const byteLength = Math.floor((body.length * 6) / 8)
  const bytes = new Uint8Array(byteLength)
  let buffer = 0
  let bits = 0
  let pos = 0
  for (const ch of body) {
    buffer = (buffer << 6) | (ch === '+' ? 62 : ch === '/' ? 63 : STD.indexOf(ch))
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[pos++] = (buffer >>> bits) & 0xff
    }
  }
  if (strict && bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    return { bytes: null, error: '严格模式：末尾有非零的多余位，编码可能被截断', urlSafe }
  }
  return { bytes: bytes.subarray(0, pos), error: '', urlSafe }
}

/** 字节 → 文本：优先 UTF-8，失败时降级 Latin-1 并给出警告 */
export function bytesToText(bytes: Uint8Array): { text: string; warning: string; utf8: boolean } {
  try {
    // ignoreBOM=true 保留原始 BOM，交给调用方决定是否剥离并提示
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return { text, warning: '', utf8: true }
  } catch {
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return {
      text,
      warning: '内容不是有效的 UTF-8（可能是图片、压缩数据或 Latin-1 文本），已按单字节显示',
      utf8: false,
    }
  }
}

function textToBytes(text: string, charset: 'utf8' | 'latin1'): { bytes: Uint8Array | null; error: string } {
  if (charset === 'utf8') return { bytes: new TextEncoder().encode(text), error: '' }
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 0xff) {
      return { bytes: null, error: `第 ${i + 1} 个字符「${text[i]}」超出 Latin-1 范围，请改用 UTF-8 字符集` }
    }
    bytes[i] = code
  }
  return { bytes, error: '' }
}

function wrapLines(text: string, wrap: number): string {
  if (wrap < 4) return text
  const width = Math.floor(wrap / 4) * 4
  const out: string[] = []
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width))
  return out.join('\n')
}

export function encodeBase64(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input) return success('', '等待输入')
  const urlSafe = boolOpt(options, 'urlSafe', false)
  const padding = boolOpt(options, 'padding', true)
  const wrap = numOpt(options, 'wrap', 0)
  const charset = strOpt(options, 'charset', 'utf8') === 'latin1' ? 'latin1' : 'utf8'

  const { bytes, error } = textToBytes(input, charset)
  if (!bytes) return failure(error)

  let text = bytesToBase64(bytes, urlSafe, padding)
  if (wrap >= 4) text = wrapLines(text, wrap)
  const bits: string[] = []
  bits.push(`${bytes.length} 字节 → ${text.replace(/\n/g, '').length} 字符`)
  if (urlSafe) bits.push('URL-safe 字母表（-_）')
  if (!padding) bits.push('无填充')
  if (wrap >= 4) bits.push(`每 ${Math.floor(wrap / 4) * 4} 字符折行`)
  return success(text, bits.join(' · '))
}

export function decodeBase64(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input.trim()) return success('', '等待输入')
  const strict = boolOpt(options, 'strict', false)
  const decoded = base64ToBytes(input, strict)
  if (!decoded.bytes) return failure(decoded.error)

  const { text, warning, utf8 } = bytesToText(decoded.bytes)
  let result = text
  let strippedBom = false
  if (result.charCodeAt(0) === 0xfeff) {
    result = result.slice(1)
    strippedBom = true
  }
  const notes = [`${decoded.bytes.length} 字节`, utf8 ? 'UTF-8 有效' : '非 UTF-8']
  if (decoded.urlSafe) notes.push('自动识别 Base64URL')
  if (/^data:[^,]*;base64,/i.test(input.trim())) notes.push('已剥离 data URI 前缀')
  if (strippedBom) notes.push('已移除 BOM')
  return success(result, notes.join(' · '), warning)
}

/** 供 JWT 使用：Base64URL 段解码为 UTF-8 文本 */
export function decodeBase64UrlSegment(segment: string): string | null {
  const decoded = base64ToBytes(segment, false)
  if (!decoded.bytes) return null
  const { text, utf8 } = bytesToText(decoded.bytes)
  return utf8 ? text : null
}
