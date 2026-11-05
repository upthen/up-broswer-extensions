import { childPath, isContainer } from '../json/value'
import type { JsonValue } from '../json/value'

/**
 * 零依赖 JSONPath 实现（MV3 CSP 禁止 eval/new Function，因此过滤表达式用递归下降自己算）。
 * 支持：$ / .name / ['name'] / [0] / [-1] / [1:5:2] / [0,2,'x'] / * / .. /
 *       [?(@.price < 10 && @.category == 'fiction')] / [?(@.isbn)] / =~ 正则。
 */
export interface JsonPathMatch {
  /** 规范化路径，如 $['store']['book'][0]['title'] */
  path: string
  value: JsonValue
}

export type JsonPathResult =
  | { ok: true; matches: JsonPathMatch[]; count: number; truncated: boolean }
  | { ok: false; message: string; index: number }

const MAX_MATCHES = 10000

type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '=~'

type Operand =
  | { kind: 'path'; keys: (string | number)[] }
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'regex'; source: string; flags: string }

type ExprNode =
  | { kind: 'or' | 'and'; left: ExprNode; right: ExprNode }
  | { kind: 'not'; expr: ExprNode }
  | { kind: 'compare'; op: CompareOp; left: Operand; right: Operand }
  | { kind: 'exists'; operand: Operand }

type Selector =
  | { kind: 'property'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; indexes: number[] }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'union'; keys: (string | number)[] }
  | { kind: 'filter'; expr: ExprNode }

type Step = { kind: 'child' | 'recursive'; selector: Selector }

interface Failure {
  message: string
  index: number
}

class Reader {
  i = 0
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.i >= this.text.length
  }
  peek(offset = 0): string {
    return this.text[this.i + offset] ?? ''
  }
  starts(token: string): boolean {
    return this.text.startsWith(token, this.i)
  }
  skipSpace(): void {
    while (!this.done && /\s/.test(this.peek())) this.i++
  }
  fail(message: string, index = this.i): Failure {
    return { message, index }
  }
}

/* ---------------- 过滤表达式 ---------------- */

class ExprParser extends Reader {
  parse(): ExprNode | Failure {
    const node = this.parseOr()
    if (isFailure(node)) return node
    this.skipSpace()
    if (!this.done) return this.fail(`过滤表达式在位置 ${this.i} 处有多余内容「${this.peek()}」`)
    return node
  }

  private parseOr(): ExprNode | Failure {
    let left = this.parseAnd()
    if (isFailure(left)) return left
    for (;;) {
      this.skipSpace()
      if (!this.starts('||')) break
      this.i += 2
      const right = this.parseAnd()
      if (isFailure(right)) return right
      left = { kind: 'or', left, right }
    }
    return left
  }

  private parseAnd(): ExprNode | Failure {
    let left = this.parseNot()
    if (isFailure(left)) return left
    for (;;) {
      this.skipSpace()
      if (!this.starts('&&')) break
      this.i += 2
      const right = this.parseNot()
      if (isFailure(right)) return right
      left = { kind: 'and', left, right }
    }
    return left
  }

  private parseNot(): ExprNode | Failure {
    this.skipSpace()
    if (this.peek() === '!') {
      this.i++
      const expr = this.parseNot()
      if (isFailure(expr)) return expr
      return { kind: 'not', expr }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExprNode | Failure {
    this.skipSpace()
    if (this.peek() === '(') {
      this.i++
      const inner = this.parseOr()
      if (isFailure(inner)) return inner
      this.skipSpace()
      if (this.peek() !== ')') return this.fail('过滤表达式缺少右括号 )')
      this.i++
      return inner
    }
    const left = this.parseOperand()
    if (isFailure(left)) return left
    this.skipSpace()
    const op = this.readCompareOp()
    if (!op) return { kind: 'exists', operand: left }
    const right = this.parseOperand()
    if (isFailure(right)) return right
    return { kind: 'compare', op, left, right }
  }

  private readCompareOp(): CompareOp | null {
    const candidates: CompareOp[] = ['==', '!=', '<=', '>=', '=~', '<', '>']
    for (const op of candidates) {
      if (this.starts(op)) {
        this.i += op.length
        return op
      }
    }
    return null
  }

  private parseOperand(): Operand | Failure {
    this.skipSpace()
    if (this.done) return this.fail('过滤表达式缺少比较值')
    const ch = this.peek()

    if (ch === '@') return this.parseAtPath()
    if (ch === '/' ) return this.parseRegex()
    if (ch === '"' || ch === "'") {
      const raw = this.readQuoted()
      if (isFailure(raw)) return raw
      return { kind: 'literal', value: raw.value }
    }
    if (ch === '-' || /\d/.test(ch)) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.i))
      if (!m) return this.fail('数字格式不正确')
      this.i += m[0].length
      return { kind: 'literal', value: Number(m[0]) }
    }
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as [string, JsonValue][]) {
      if (this.starts(word)) {
        this.i += word.length
        return { kind: 'literal', value }
      }
    }
    return this.fail(`无法识别的过滤条件「${this.text.slice(this.i, this.i + 12)}」，可用 @.字段 / 数字 / '字符串' / true / false / null`)
  }

  private parseAtPath(): Operand | Failure {
    this.i++ // @
    const keys: (string | number)[] = []
    while (!this.done) {
      if (this.peek() === '.') {
        this.i++
        const name = this.readBareName()
        if (!name) return this.fail('@ 后面需要写字段名，例如 @.price')
        keys.push(name)
      } else if (this.peek() === '[') {
        const close = this.findBracketEnd(this.i)
        if (close < 0) return this.fail('@[ 缺少右中括号 ]')
        const body = this.text.slice(this.i + 1, close).trim()
        const key = parseSingleKey(body)
        if (key === null) return this.fail(`@[${body}] 里只能写一个字段名或下标`)
        keys.push(key)
        this.i = close + 1
      } else break
    }
    return { kind: 'path', keys }
  }

  private parseRegex(): Operand | Failure {
    this.i++ // /
    let source = ''
    let escaped = false
    while (!this.done) {
      const ch = this.peek()
      this.i++
      if (escaped) {
        source += ch
        escaped = false
      } else if (ch === '\\') {
        source += ch
        escaped = true
      } else if (ch === '/') {
        let flags = ''
        while (/[a-z]/i.test(this.peek())) {
          flags += this.peek()
          this.i++
        }
        try {
          new RegExp(source, flags)
        } catch {
          return this.fail(`正则表达式 /${source}/${flags} 无效`, this.i)
        }
        return { kind: 'regex', source, flags }
      } else source += ch
    }
    return this.fail('正则表达式缺少结尾的 /')
  }

  private readBareName(): string {
    const m = /^[\w$\-\u0080-\uffff]+/.exec(this.text.slice(this.i))
    if (!m) return ''
    this.i += m[0].length
    return m[0]
  }

  /** 从 text[start] === '[' 起找配对的 ] */
  private findBracketEnd(start: number): number {
    for (let j = start + 1; j < this.text.length; j++) {
      if (this.text[j] === ']') return j
      if (this.text[j] === '"' || this.text[j] === "'") {
        const q = this.text[j]
        j++
        while (j < this.text.length && this.text[j] !== q) {
          if (this.text[j] === '\\') j++
          j++
        }
      }
    }
    return -1
  }

  private readQuoted(): { value: string } | Failure {
    const quote = this.peek()
    this.i++
    let out = ''
    while (!this.done) {
      const ch = this.peek()
      this.i++
      if (ch === quote) return { value: out }
      if (ch === '\\') {
        const next = this.peek()
        this.i++
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
        out += map[next] ?? next
      } else out += ch
    }
    return this.fail('字符串缺少结束引号')
  }
}

function isFailure<T>(value: T | Failure): value is Failure {
  return typeof value === 'object' && value !== null && 'message' in value && 'index' in value
}

/* ---------------- 路径表达式 ---------------- */

function parseSingleKey(body: string): string | number | null {
  const trimmed = body.trim()
  if (!trimmed) return null
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return unquote(trimmed)
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  if (/^[\w$\-\u0080-\uffff]+$/.test(trimmed)) return trimmed
  return null
}

function unquote(raw: string): string {
  let out = ''
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] === '\\') {
      const next = raw[++i]
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
      out += map[next] ?? next
    } else out += raw[i]
  }
  return out
}

function splitUnion(body: string): string[] {
  const parts: string[] = []
  let buf = ''
  let quote = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      buf += ch
      if (ch === '\\') buf += body[++i] ?? ''
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
    } else if (ch === ',') {
      parts.push(buf.trim())
      buf = ''
    } else buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function parseSelector(body: string, baseIndex: number): Selector | Failure {
  const trimmed = body.trim()
  if (!trimmed) return { message: '中括号里不能为空', index: baseIndex }

  if (trimmed.startsWith('?(') && trimmed.endsWith(')')) {
    const parser = new ExprParser(trimmed.slice(2, -1))
    const expr = parser.parse()
    if (isFailure(expr)) return { message: expr.message, index: baseIndex + 2 + expr.index }
    return { kind: 'filter', expr }
  }
  if (trimmed === '*') return { kind: 'wildcard' }

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length > 3) return { message: '切片最多写三段：[start:end:step]', index: baseIndex }
    const num = (s: string): number | undefined => {
      const t = s.trim()
      return t === '' ? undefined : Number(t)
    }
    const [start, end, step] = parts.map(num)
    if ([start, end, step].some((n) => n !== undefined && !Number.isFinite(n))) {
      return { message: '切片里的数字不合法', index: baseIndex }
    }
    if (step === 0) return { message: '切片步长不能为 0', index: baseIndex }
    return { kind: 'slice', start, end, step }
  }

  if (trimmed.includes(',')) {
    const keys: (string | number)[] = []
    for (const part of splitUnion(trimmed)) {
      const key = parseSingleKey(part)
      if (key === null) return { message: `无法识别的联合选择项「${part}」`, index: baseIndex }
      keys.push(key)
    }
    return { kind: 'union', keys }
  }

  const key = parseSingleKey(trimmed)
  if (key === null) return { message: `无法识别的中括号内容「${trimmed}」`, index: baseIndex }
  return typeof key === 'number' ? { kind: 'index', indexes: [key] } : { kind: 'property', name: key }
}

function parsePath(expr: string): Step[] | Failure {
  const reader = new Reader(expr)
  reader.skipSpace()
  if (reader.peek() !== '$') {
    return reader.fail('表达式必须以 $ 开头，例如 $.name 或 $..title')
  }
  reader.i++
  const steps: Step[] = []

  while (!reader.done) {
    reader.skipSpace()
    if (reader.done) break
    if (reader.peek() === '.') {
      if (reader.peek(1) === '.') {
        reader.i += 2
        if (reader.peek() === '[') {
          const sel = readBracket(reader)
          if (isFailure(sel)) return sel
          steps.push({ kind: 'recursive', selector: sel })
        } else if (reader.done || reader.peek() === '.' || reader.peek() === '*') {
          if (reader.peek() === '*') reader.i++
          steps.push({ kind: 'recursive', selector: { kind: 'wildcard' } })
        } else {
          const name = readName(reader)
          if (!name) return reader.fail('.. 后面需要写字段名或 *')
          steps.push({ kind: 'recursive', selector: { kind: 'property', name } })
        }
      } else {
        reader.i++
        if (reader.peek() === '*') {
          reader.i++
          steps.push({ kind: 'child', selector: { kind: 'wildcard' } })
        } else {
          const name = readName(reader)
          if (!name) return reader.fail('. 后面需要写字段名或 *')
          steps.push({ kind: 'child', selector: { kind: 'property', name } })
        }
      }
    } else if (reader.peek() === '[') {
      const sel = readBracket(reader)
      if (isFailure(sel)) return sel
      steps.push({ kind: 'child', selector: sel })
    } else {
      return reader.fail(`位置 ${reader.i} 出现无法识别的字符「${reader.peek()}」，属性前请写 .`)
    }
  }
  return steps
}

function readName(reader: Reader): string {
  const m = /^[\w$\-\u0080-\uffff]+/.exec(reader.text.slice(reader.i))
  if (!m) return ''
  reader.i += m[0].length
  return m[0]
}

function readBracket(reader: Reader): Selector | Failure {
  const start = reader.i
  let quote = ''
  let paren = 0
  let j = start + 1
  for (; j < reader.text.length; j++) {
    const ch = reader.text[j]
    if (quote) {
      if (ch === '\\') j++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') paren++
    else if (ch === ')') paren--
    else if (ch === ']' && paren === 0) break
  }
  if (j >= reader.text.length) return reader.fail('中括号缺少右括号 ]', start)
  const body = reader.text.slice(start + 1, j)
  const sel = parseSelector(body, start + 1)
  if (isFailure(sel)) return sel
  reader.i = j + 1
  return sel
}

/* ---------------- 求值 ---------------- */

const MISSING = Symbol('missing')

function resolveOperand(operand: Operand, current: JsonValue): JsonValue | typeof MISSING | RegExp {
  if (operand.kind === 'literal') return operand.value
  if (operand.kind === 'regex') return new RegExp(operand.source, operand.flags)
  let value: JsonValue = current
  for (const key of operand.keys) {
    if (typeof key === 'number') {
      if (!Array.isArray(value) || key < 0 || key >= value.length) return MISSING
      value = value[key]
    } else {
      if (!isContainer(value) || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, key)) return MISSING
      value = value[key]
    }
  }
  return value
}

function looseEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function evalExpr(node: ExprNode, current: JsonValue): boolean {
  switch (node.kind) {
    case 'or':
      return evalExpr(node.left, current) || evalExpr(node.right, current)
    case 'and':
      return evalExpr(node.left, current) && evalExpr(node.right, current)
    case 'not':
      return !evalExpr(node.expr, current)
    case 'exists': {
      const value = resolveOperand(node.operand, current)
      return value !== MISSING && !(value instanceof RegExp)
    }
    case 'compare': {
      const left = resolveOperand(node.left, current)
      const right = resolveOperand(node.right, current)
      if (left === MISSING || right === MISSING || left instanceof RegExp || right instanceof RegExp) {
        if (node.op === '=~' && right instanceof RegExp && left !== MISSING && !(left instanceof RegExp)) {
          return right.test(String(left))
        }
        return false
      }
      const a = left as JsonValue
      const b = right as JsonValue
      switch (node.op) {
        case '==':
          return looseEqual(a, b)
        case '!=':
          return !looseEqual(a, b)
        case '=~':
          return new RegExp(String(b)).test(String(a))
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const bothNumbers = typeof a === 'number' && typeof b === 'number'
          const x: number | string = bothNumbers ? (a as number) : String(a)
          const y: number | string = bothNumbers ? (b as number) : String(b)
          if (node.op === '<') return x < y
          if (node.op === '<=') return x <= y
          if (node.op === '>') return x > y
          return x >= y
        }
      }
      return false
    }
  }
}

function descendants(node: JsonPathMatch): JsonPathMatch[] {
  // 广度优先，保证结果顺序与文档顺序一致
  const out: JsonPathMatch[] = [node]
  for (let i = 0; i < out.length && out.length < MAX_MATCHES * 2; i++) {
    const current = out[i]
    if (!isContainer(current.value)) continue
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        out.push({ path: childPath(current.path, index), value: item })
      })
    } else {
      for (const key of Object.keys(current.value)) {
        out.push({ path: childPath(current.path, key), value: current.value[key] })
      }
    }
  }
  return out
}

function applySelector(node: JsonPathMatch, selector: Selector, out: JsonPathMatch[]): void {
  const value = node.value
  switch (selector.kind) {
    case 'property': {
      if (isContainer(value) && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, selector.name)) {
        out.push({ path: childPath(node.path, selector.name), value: value[selector.name] })
      }
      return
    }
    case 'wildcard': {
      if (!isContainer(value)) return
      if (Array.isArray(value)) {
        value.forEach((item, i) => out.push({ path: childPath(node.path, i), value: item }))
      } else {
        for (const key of Object.keys(value)) out.push({ path: childPath(node.path, key), value: value[key] })
      }
      return
    }
    case 'index': {
      if (!Array.isArray(value)) return
      for (const raw of selector.indexes) {
        const i = raw < 0 ? value.length + raw : raw
        if (i >= 0 && i < value.length) out.push({ path: childPath(node.path, i), value: value[i] })
      }
      return
    }
    case 'slice': {
      if (!Array.isArray(value)) return
      const step = selector.step ?? 1
      const len = value.length
      let start = selector.start ?? (step > 0 ? 0 : len - 1)
      let end = selector.end ?? (step > 0 ? len : -1)
      if (start < 0) start = Math.max(0, len + start)
      if (end < 0 && selector.end !== undefined) end = Math.max(0, len + end)
      if (step > 0) {
        start = Math.min(Math.max(0, start), len)
        end = Math.min(Math.max(0, end), len)
        for (let i = start; i < end; i += step) out.push({ path: childPath(node.path, i), value: value[i] })
      } else {
        for (let i = Math.min(start, len - 1); i > end; i += step) {
          if (i >= 0 && i < len) out.push({ path: childPath(node.path, i), value: value[i] })
        }
      }
      return
    }
    case 'union': {
      if (!isContainer(value)) return
      for (const key of selector.keys) {
        if (typeof key === 'number' && Array.isArray(value)) {
          const i = key < 0 ? value.length + key : key
          if (i >= 0 && i < value.length) out.push({ path: childPath(node.path, i), value: value[i] })
        } else if (typeof key === 'string' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
          out.push({ path: childPath(node.path, key), value: value[key] })
        }
      }
      return
    }
    case 'filter': {
      if (!isContainer(value)) return
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (evalExpr(selector.expr, item)) out.push({ path: childPath(node.path, i), value: item })
        })
      } else {
        for (const key of Object.keys(value)) {
          if (evalExpr(selector.expr, value[key])) out.push({ path: childPath(node.path, key), value: value[key] })
        }
      }
    }
  }
}

/** 常用表达式，UI 里做快捷按钮 */
export const JSONPATH_PRESETS: { label: string; expression: string }[] = [
  { label: '顶层字段', expression: '$.*' },
  { label: '递归找字段', expression: '$..title' },
  { label: '数组首元素', expression: '$.features[0]' },
  { label: '数组切片', expression: '$.features[0:2]' },
  { label: '条件过滤', expression: '$..[?(@.enabled == true)]' },
  { label: '数值比较', expression: '$.features[?(@.id >= 2)].title' },
  { label: '通配数组', expression: '$.tags[*]' },
]

/**
 * 在已解析的 JSON 值上执行查询。
 * 返回值是纯数据，UI 可以直接渲染；不依赖 DOM / chrome API。
 */
export function queryJsonPath(root: JsonValue, expression: string): JsonPathResult {
  if (!expression.trim()) {
    return { ok: false, message: '请输入 JSONPath 表达式', index: 0 }
  }
  const parsed = parsePath(expression)
  if (isFailure(parsed)) return { ok: false, ...parsed }

  let current: JsonPathMatch[] = [{ path: '$', value: root }]
  let truncated = false
  for (const step of parsed) {
    const next: JsonPathMatch[] = []
    const seen = new Set<string>()
    for (const node of current) {
      const candidates = step.kind === 'recursive' ? descendants(node) : [node]
      for (const candidate of candidates) {
        applySelector(candidate, step.selector, next)
        if (next.length >= MAX_MATCHES) {
          truncated = true
          break
        }
      }
      if (truncated) break
    }
    const unique: JsonPathMatch[] = []
    for (const match of next) {
      if (seen.has(match.path)) continue
      seen.add(match.path)
      unique.push(match)
    }
    current = unique
    if (truncated) break
  }

  const matches = current.slice(0, MAX_MATCHES)
  return { ok: true, matches, count: matches.length, truncated }
}
