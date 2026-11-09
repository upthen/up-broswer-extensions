/** HTML 实体：命名实体 + 十进制/十六进制数字实体，纯字符串实现（不依赖 DOM，便于单测） */

import { boolOpt, strOpt, success } from './types'
import type { EncodeResult, EncodingOptions } from './types'

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  laquo: '\u00ab',
  raquo: '\u00bb',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  sect: '\u00a7',
  para: '\u00b6',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  micro: '\u00b5',
  sup1: '\u00b9',
  sup2: '\u00b2',
  sup3: '\u00b3',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  acute: '\u00b4',
  cedil: '\u00b8',
  uml: '\u00a8',
  not: '\u00ac',
  shy: '\u00ad',
  macr: '\u00af',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  eacute: '\u00e9',
  egrave: '\u00e8',
  agrave: '\u00e0',
  aacute: '\u00e1',
  ouml: '\u00f6',
  uuml: '\u00fc',
  ntilde: '\u00f1',
  ccedil: '\u00e7',
  Alpha: '\u0391',
  beta: '\u03b2',
  pi: '\u03c0',
  rarr: '\u2192',
  larr: '\u2190',
  uarr: '\u2191',
  darr: '\u2193',
  harr: '\u2194',
  check: '\u2713',
  hearts: '\u2665',
}

/** HTML5 规定 &#x80;–&#x9F; 按 Windows-1252 解释，而不是 C1 控制字符 */
const WIN1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
}

/** 允许省略分号的 legacy 命名实体 */
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', 'copy', 'reg', 'nbsp'])

const ESCAPE_NAMED: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export type HtmlMode = 'minimal' | 'nonAscii' | 'all'

function numericEntity(cp: number, decimal: boolean, uppercase: boolean): string {
  if (decimal) return `&#${cp};`
  const value = cp.toString(16)
  return `&#x${uppercase ? value.toUpperCase() : value};`
}

export function encodeHtml(input: string, options: EncodingOptions = {}): EncodeResult {
  if (!input) return success('', '等待输入')
  const raw = strOpt(options, 'mode', 'minimal')
  const mode: HtmlMode = raw === 'nonAscii' || raw === 'all' ? raw : 'minimal'
  const decimal = boolOpt(options, 'decimal', false)
  const uppercase = boolOpt(options, 'uppercase', false)

  let out = ''
  let converted = 0
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number
    if (ESCAPE_NAMED[ch]) {
      out += ESCAPE_NAMED[ch]
      converted++
    } else if (mode === 'all' || (mode === 'nonAscii' && cp > 0x7f)) {
      out += numericEntity(cp, decimal, uppercase)
      converted++
    } else {
      out += ch
    }
  }
  const labels: Record<HtmlMode, string> = {
    minimal: '仅转义 & < > " \'',
    nonAscii: '必要字符 + 非 ASCII 转数字实体',
    all: '全部字符转数字实体',
  }
  return success(out, `${labels[mode]} · ${decimal ? '十进制' : '十六进制'} · 共转换 ${converted} 处`)
}

export function decodeHtml(input: string): EncodeResult {
  if (!input) return success('', '等待输入')
  const pattern = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]{1,31}))(;?)/g
  let count = 0
  let replaced = 0

  const text = input.replace(pattern, (match, hex, dec, name, semicolon: string) => {
    if (hex !== undefined || dec !== undefined) {
      const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10)
      const mapped = WIN1252[cp] ?? cp
      if ((mapped >= 0xd800 && mapped <= 0xdfff) || mapped > 0x10ffff || mapped < 0) {
        replaced++
        count++
        return '\ufffd'
      }
      count++
      return String.fromCodePoint(mapped)
    }
    if (name !== undefined) {
      // 命名实体必须有分号（少数 legacy 实体除外），避免把 &notit; 误拆成 ¬it;
      if (!semicolon && !LEGACY.has(name)) return match
      const value = NAMED[name]
      if (value === undefined) return match
      count++
      return value
    }
    return match
  })

  return success(
    text,
    `还原 ${count} 个实体`,
    replaced ? `${replaced} 个数字实体超出 Unicode 范围，已替换为 U+FFFD` : '',
  )
}
