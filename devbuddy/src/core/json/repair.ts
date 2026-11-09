import { parseJson } from './parser'
import type { JsonError } from './types'

export interface RepairChange {
  rule: string
  count: number
}

export type RepairResult =
  | { ok: true; text: string; changes: RepairChange[]; alreadyValid: boolean }
  | { ok: false; text: string; changes: RepairChange[]; error: JsonError }

const RULE = {
  bom: '移除 BOM 头',
  comment: '移除注释',
  singleQuote: '单引号改双引号',
  quoteKey: '补全属性名引号',
  quoteValue: '补全字符串引号',
  trailingComma: '移除多余逗号',
  fullWidth: '全角标点转半角',
  literal: '修正字面量',
  number: '修正数字写法',
  newline: '转义字符串内的换行',
  escape: '修正非法转义',
  region: '截取 JSON 主体',
} as const

/** 保持规则在输出里的稳定顺序 */
const RULE_ORDER: string[] = [
  RULE.bom,
  RULE.region,
  RULE.comment,
  RULE.fullWidth,
  RULE.singleQuote,
  RULE.quoteKey,
  RULE.quoteValue,
  RULE.trailingComma,
  RULE.literal,
  RULE.number,
  RULE.newline,
  RULE.escape,
]

const IDENT_CHAR = /[\w$\u4e00-\u9fa5]/

function readString(
  src: string,
  start: number,
  bump: (rule: string) => void,
): { text: string; next: number } {
  const open = src[start]
  const single = open !== '"'
  const closers: string[] =
    open === '“' ? ['”', '"'] : open === '‘' ? ['’', "'"] : [open]
  let i = start + 1
  let body = ''

  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\') {
      const n = src[i + 1]
      if (n === undefined) {
        body += '\\\\'
        i += 1
        continue
      }
      if (n === "'") {
        body += "'"
        bump(RULE.escape)
        i += 2
        continue
      }
      if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) {
        body += '\\u00' + src.slice(i + 2, i + 4)
        bump(RULE.escape)
        i += 4
        continue
      }
      if ('"\\/bfnrtu'.includes(n)) {
        body += '\\' + n
        i += 2
        continue
      }
      body += n
      bump(RULE.escape)
      i += 2
      continue
    }

    if (closers.includes(ch)) {
      i += 1
      break
    }

    if (ch === '"') {
      body += '\\"'
      i += 1
      continue
    }

    const code = ch.charCodeAt(0)
    if (code < 0x20) {
      if (ch === '\r') {
        i += src[i + 1] === '\n' ? 2 : 1
        body += '\\n'
      } else if (ch === '\n') {
        body += '\\n'
        i += 1
      } else if (ch === '\t') {
        body += '\\t'
        i += 1
      } else {
        body += '\\u' + code.toString(16).padStart(4, '0')
        i += 1
      }
      bump(RULE.newline)
      continue
    }

    body += ch
    i += 1
  }

  if (single) bump(RULE.singleQuote)
  return { text: '"' + body + '"', next: i }
}

function normalize(src: string): { text: string; counts: Map<string, number> } {
  const counts = new Map<string, number>()
  const bump = (rule: string) => counts.set(rule, (counts.get(rule) ?? 0) + 1)

  let out = ''
  let i = 0
  const len = src.length

  while (i < len) {
    const c = src[i]

    if (c === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') i += 1
      bump(RULE.comment)
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? len : end + 2
      bump(RULE.comment)
      continue
    }

    if (c === '"' || c === "'" || c === '“' || c === '”' || c === '‘' || c === '’') {
      const res = readString(src, i, bump)
      out += res.text
      i = res.next
      continue
    }

    if (c === '，') {
      out += ','
      bump(RULE.fullWidth)
      i += 1
      continue
    }
    if (c === '：') {
      out += ':'
      bump(RULE.fullWidth)
      i += 1
      continue
    }
    if (c === '｛' || c === '【') {
      out += '{'
      bump(RULE.fullWidth)
      i += 1
      continue
    }
    if (c === '｝' || c === '】') {
      out += '}'
      bump(RULE.fullWidth)
      i += 1
      continue
    }
    if (c === '［') {
      out += '['
      bump(RULE.fullWidth)
      i += 1
      continue
    }
    if (c === '］') {
      out += ']'
      bump(RULE.fullWidth)
      i += 1
      continue
    }

    if (c === ',') {
      let j = i + 1
      while (j < len && /\s/.test(src[j])) j += 1
      if (src[j] === '}' || src[j] === ']') {
        bump(RULE.trailingComma)
        i += 1
        continue
      }
      out += ','
      i += 1
      continue
    }

    if (c === '+') {
      bump(RULE.number)
      i += 1
      continue
    }
    if (c === '.' && !/[0-9]/.test(out[out.length - 1] ?? '')) {
      out += '0.'
      bump(RULE.number)
      i += 1
      continue
    }
    if (c === '0' && /[0-9]/.test(src[i + 1] ?? '') && !/[0-9.]/.test(out[out.length - 1] ?? '')) {
      i += 1
      while (i < len && src[i] === '0') i += 1
      bump(RULE.number)
      continue
    }

    if (/[A-Za-z_$\u4e00-\u9fa5]/.test(c)) {
      let j = i
      while (j < len && IDENT_CHAR.test(src[j])) j += 1
      const word = src.slice(i, j)
      const lower = word.toLowerCase()
      if (word === 'true' || word === 'false' || word === 'null') {
        out += word
      } else if (lower === 'true' || lower === 'false' || lower === 'null') {
        out += lower
        bump(RULE.literal)
      } else if (lower === 'undefined' || lower === 'nan' || lower === 'infinity') {
        out += 'null'
        bump(RULE.literal)
      } else {
        let k = j
        while (k < len && /\s/.test(src[k])) k += 1
        out += '"' + word + '"'
        bump(src[k] === ':' ? RULE.quoteKey : RULE.quoteValue)
      }
      i = j
      continue
    }

    out += c
    i += 1
  }

  return { text: out, counts }
}

function sliceJsonBody(src: string): string | null {
  const starts = [src.indexOf('{'), src.indexOf('[')].filter((n) => n >= 0)
  if (!starts.length) return null
  const start = Math.min(...starts)
  const endBrace = Math.max(src.lastIndexOf('}'), src.lastIndexOf(']'))
  if (endBrace < start) return null
  if (start === 0 && endBrace === src.length - 1) return null
  return src.slice(start, endBrace + 1)
}

function toChangeList(counts: Map<string, number>): RepairChange[] {
  return RULE_ORDER.filter((rule) => counts.has(rule)).map((rule) => ({ rule, count: counts.get(rule) ?? 0 }))
}

function mergeCounts(target: Map<string, number>, source: Map<string, number>) {
  for (const [k, v] of source) target.set(k, (target.get(k) ?? 0) + v)
}

export function repairJsonText(source: string): RepairResult {
  let text = source
  const counts = new Map<string, number>()

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
    counts.set(RULE.bom, 1)
  }

  const direct = parseJson(text)
  if (direct.ok) {
    return { ok: true, text, changes: toChangeList(counts), alreadyValid: counts.size === 0 }
  }

  const candidates: string[] = [text]
  const sliced = sliceJsonBody(text)
  if (sliced) candidates.push(sliced)

  let best = ''
  let lastError: JsonError = direct.error

  for (const candidate of candidates) {
    const normalized = normalize(candidate)
    const merged = new Map(counts)
    mergeCounts(merged, normalized.counts)
    if (candidate !== text) merged.set(RULE.region, (merged.get(RULE.region) ?? 0) + 1)

    const parsed = parseJson(normalized.text)
    if (parsed.ok) {
      return { ok: true, text: normalized.text, changes: toChangeList(merged), alreadyValid: false }
    }
    best = normalized.text
    lastError = parsed.error
  }

  return { ok: false, text: best, changes: toChangeList(counts), error: lastError }
}
