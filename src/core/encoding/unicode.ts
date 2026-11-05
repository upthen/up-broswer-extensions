/** Unicode / JS 字面量转义：\uXXXX、\u{...}、\xNN、\UXXXXXXXX 与常见控制字符 */

import { boolOpt, strOpt, success } from './types'
import type { EncodeResult, EncodingOptions } from './types'

export type UnicodeStyle = 'u4' | 'brace' | 'hex'

const SHORT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v',
  '\0': '\\0',
}

const SHORT_VALUES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '/': '/',
}

function hex(code: number, width: number, uppercase: boolean): string {
  const value = code.toString(16).padStart(width, '0')
  return uppercase ? value.toUpperCase() : value
}

function escapeCodePoint(cp: number, style: UnicodeStyle, uppercase: boolean): string {
  if (style === 'brace') return `\\u{${hex(cp, 1, uppercase)}}`
  if (style === 'hex' && cp <= 0xff) return `\\x${hex(cp, 2, uppercase)}`
  if (cp <= 0xffff) return `\\u${hex(cp, 4, uppercase)}`
  // \uXXXX 无法直接表示辅助平面字符，拆成 UTF-16 代理对
  const offset = cp - 0x10000
  const high = 0xd800 + (offset >>> 10)
  const low = 0xdc00 + (offset & 0x3ff)
  return `\\u${hex(high, 4, uppercase)}\\u${hex(low, 4, uppercase)}`
}

export function encodeUnicode(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input) return success('', '等待输入')
  const rawStyle = strOpt(options, 'style', 'u4')
  const style: UnicodeStyle = rawStyle === 'brace' || rawStyle === 'hex' ? rawStyle : 'u4'
  const nonAsciiOnly = boolOpt(options, 'nonAsciiOnly', true)
  const escapeControls = boolOpt(options, 'escapeControls', true)
  const uppercase = boolOpt(options, 'uppercase', false)

  let out = ''
  let escaped = 0
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number
    if (escapeControls && SHORT_ESCAPES[ch]) {
      out += SHORT_ESCAPES[ch]
      escaped++
      continue
    }
    // \xNN 表达的是字节视角，所有字符都转义才符合直觉
    const keep = style !== 'hex' && nonAsciiOnly
      ? cp >= 0x20 && cp <= 0x7e && ch !== '"' && ch !== '\\'
      : false
    if (keep) {
      out += ch
    } else {
      out += escapeCodePoint(cp, style, uppercase)
      escaped++
    }
  }
  const styleLabel: Record<UnicodeStyle, string> = {
    u4: '\\uXXXX（辅助平面拆代理对）',
    brace: '\\u{...}（ES6 码点）',
    hex: '\\xNN（>0xFF 自动用 \\u）',
  }
  return success(out, `${styleLabel[style]} · 共转义 ${escaped} 个字符`)
}

const RE_BRACE = /\\u\{([0-9a-fA-F]{1,6})\}/y
const RE_U4 = /\\u([0-9a-fA-F]{4})/y
const RE_U8 = /\\U([0-9a-fA-F]{8})/y
const RE_X2 = /\\x([0-9a-fA-F]{2})/y
const RE_SHORT = /\\([nrtbfv0\\"'/])/y

/** 解析 \u{...}、\uXXXX（含代理对合并）、\UXXXXXXXX、\xNN 与短转义；未知序列原样保留 */
export function decodeUnicode(input: string): EncodeResult {
  if (!input) return success('', '等待输入')
  let out = ''
  let count = 0
  let badCodePoint = false
  let i = 0

  const match = (re: RegExp, at: number): RegExpExecArray | null => {
    re.lastIndex = at
    return re.exec(input)
  }
  const pushCodePoint = (cp: number) => {
    if (cp > 0x10ffff) {
      badCodePoint = true
      out += '\ufffd'
    } else out += String.fromCodePoint(cp)
    count++
  }

  while (i < input.length) {
    if (input[i] !== '\\') {
      out += input[i++]
      continue
    }
    let m = match(RE_BRACE, i)
    if (m) {
      pushCodePoint(parseInt(m[1], 16))
      i = RE_BRACE.lastIndex
      continue
    }
    m = match(RE_U4, i)
    if (m) {
      const unit = parseInt(m[1], 16)
      const end = RE_U4.lastIndex
      // 高代理 + 紧随的低代理 → 合并成一个码点（同时消费两段）
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = match(RE_U4, end)
        if (next) {
          const low = parseInt(next[1], 16)
          if (low >= 0xdc00 && low <= 0xdfff) {
            out += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00))
            count++
            i = RE_U4.lastIndex
            continue
          }
        }
      }
      out += String.fromCharCode(unit)
      count++
      i = end
      continue
    }
    m = match(RE_U8, i)
    if (m) {
      pushCodePoint(parseInt(m[1], 16))
      i = RE_U8.lastIndex
      continue
    }
    m = match(RE_X2, i)
    if (m) {
      out += String.fromCharCode(parseInt(m[1], 16))
      count++
      i = RE_X2.lastIndex
      continue
    }
    m = match(RE_SHORT, i)
    if (m) {
      out += SHORT_VALUES[m[1]] ?? m[0]
      count++
      i = RE_SHORT.lastIndex
      continue
    }
    out += input[i++]
  }

  return success(
    out,
    `还原 ${count} 处转义`,
    badCodePoint ? '存在超出 Unicode 范围的码点，已替换为 U+FFFD' : '',
  )
}
