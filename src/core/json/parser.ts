import type { JsonEntry, JsonError, JsonErrorCode, JsonNode, ParseResult } from './types'

/** 内部异常，用于从递归下降里一路抛到顶层 */
class ParseFail extends Error {
  constructor(readonly detail: JsonError) {
    super(detail.message)
  }
}

const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9'
const isHex = (c: string | undefined) => !!c && /[0-9a-fA-F]/.test(c)
const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const isIdentStart = (c: string | undefined) => !!c && /[A-Za-z_$\u4e00-\u9fa5]/.test(c)

/** 把不可见字符变成可读描述，避免报错信息里出现空串 */
function showChar(c: string | undefined): string {
  if (c === undefined) return '文件结尾'
  if (c === '\n') return '换行'
  if (c === '\t') return '制表符 Tab'
  if (c === '\r') return '回车'
  if (c === ' ') return '空格'
  return c
}

function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') starts.push(i + 1)
    else if (c === '\r') {
      if (text[i + 1] === '\n') continue
      starts.push(i + 1)
    }
  }
  return starts
}

function decodeStringBody(body: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = body[++i]
    switch (n) {
      case '"':
        out += '"'
        break
      case '\\':
        out += '\\'
        break
      case '/':
        out += '/'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'u': {
        const hex = body.slice(i + 1, i + 5)
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        break
      }
      default:
        out += n ?? ''
    }
  }
  return out
}

class Parser {
  private pos = 0
  private readonly lineStarts: number[]

  constructor(private readonly text: string) {
    this.lineStarts = buildLineStarts(text)
  }

  run(): ParseResult {
    try {
      if (!this.text.trim()) {
        throw this.fail(
          'EMPTY',
          '还没有输入内容',
          '可以点「示例」载入一份 JSON，或把 JSON 粘贴进来',
        )
      }
      this.skipWs()
      const root = this.parseValue()
      this.skipWs()
      if (this.text[this.pos] === '/' && (this.text[this.pos + 1] === '/' || this.text[this.pos + 1] === '*')) {
        throw this.fail('COMMENT', 'JSON 不支持注释', '删除 // 行注释或 /* */ 块注释（点「修复」可自动移除）')
      }
      if (this.pos < this.text.length) {
        throw this.fail(
          'TRAILING_CONTENT',
          `JSON 已经结束，后面还有多余内容「${showChar(this.text[this.pos])}」`,
          '根节点之后只能有空白字符；如果粘贴了多段内容，请只保留一段',
        )
      }
      return { ok: true, root }
    } catch (e) {
      if (e instanceof ParseFail) return { ok: false, error: e.detail }
      throw e
    }
  }

  private fail(code: JsonErrorCode, message: string, hint?: string, index = this.pos): ParseFail {
    const { line, column } = this.locate(index)
    const from = Math.max(0, index - 24)
    const snippet = this.text.slice(from, Math.min(this.text.length, index + 24)).replace(/\r?\n/g, '⏎')
    return new ParseFail({ code, index, line, column, message, hint, snippet })
  }

  private locate(index: number): { line: number; column: number } {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: index - this.lineStarts[lo] + 1 }
  }

  private skipWs() {
    while (this.pos < this.text.length && isWs(this.text[this.pos])) this.pos++
  }

  private parseValue(): JsonNode {
    this.skipWs()
    const ch = this.text[this.pos]
    if (ch === undefined) {
      throw this.fail('INCOMPLETE', 'JSON 内容不完整，值还没写完就到结尾了', '检查是否缺少闭合的 } 或 ]')
    }
    if (ch === '{') return this.parseObject()
    if (ch === '[') return this.parseArray()
    if (ch === '"') return this.parseString()
    if (ch === "'") {
      throw this.fail(
        'SINGLE_QUOTE',
        "JSON 的字符串必须使用双引号，不能用单引号",
        '把 \'…\' 换成 "…"（点「修复」可自动处理）',
      )
    }
    if (ch === '/') {
      throw this.fail(
        'COMMENT',
        'JSON 不支持注释',
        '删除 // 行注释或 /* */ 块注释（点「修复」可自动移除）',
      )
    }
    if (ch === '+') {
      throw this.fail('BAD_NUMBER', '数字不能以 + 开头', '把 +1 改成 1（点「修复」可自动处理）')
    }
    if (ch === '-' || isDigit(ch)) return this.parseNumber()
    if (ch === 't' || ch === 'f' || ch === 'n') return this.parseLiteral()
    if (ch === '}' || ch === ']') {
      throw this.fail(
        'UNEXPECTED',
        `这里多了一个「${ch}」`,
        '前面可能多了一个逗号，或者这个闭合符号没有对应的开始符号',
      )
    }
    if (isIdentStart(ch)) {
      throw this.fail(
        'UNQUOTED_KEY',
        '属性名/字符串必须用双引号包裹',
        `把 ${this.peekWord()} 改成 "${this.peekWord()}"`,
      )
    }
    throw this.fail('UNEXPECTED', `这里出现了无法解析的字符「${showChar(ch)}」`, 'JSON 只允许对象、数组、字符串、数字、true/false/null')
  }

  private peekWord(): string {
    let end = this.pos
    while (end < this.text.length && /[\w$\u4e00-\u9fa5]/.test(this.text[end])) end++
    return this.text.slice(this.pos, end) || this.text[this.pos] || ''
  }

  private parseObject(): JsonNode {
    const start = this.pos
    this.pos++ // {
    const entries: JsonEntry[] = []
    this.skipWs()
    if (this.text[this.pos] === '}') {
      this.pos++
      return { type: 'object', entries, start, end: this.pos }
    }
    for (;;) {
      this.skipWs()
      const at = this.pos
      const ch = this.text[this.pos]
      if (ch === undefined) {
        throw this.fail('INCOMPLETE', '对象还没闭合就到结尾了', '补上缺少的 }')
      }
      if (ch === '}') {
        throw this.fail('TRAILING_COMMA', '多了一个逗号：逗号后面紧跟 }', '删除最后一个成员后的逗号（点「修复」可自动移除）')
      }
      if (ch === "'") {
        throw this.fail('SINGLE_QUOTE', '属性名必须使用双引号，不能用单引号', '把 \'key\' 换成 "key"（点「修复」可自动处理）')
      }
      if (ch !== '"') {
        if (isIdentStart(ch)) {
          throw this.fail(
            'UNQUOTED_KEY',
            `属性名「${this.peekWord()}」没有用双引号包裹`,
            `改成 "${this.peekWord()}": …（点「修复」可自动补全引号）`,
          )
        }
        throw this.fail('UNEXPECTED', `对象的属性名位置出现了「${showChar(ch)}」`, '属性名必须是双引号字符串')
      }
      const keyNode = this.parseString()
      this.skipWs()
      if (this.text[this.pos] !== ':') {
        const bad = this.text[this.pos]
        throw this.fail(
          'MISSING_COLON',
          bad === undefined ? '属性名后面缺少冒号，内容就到结尾了' : `属性名后面缺少冒号，这里是「${showChar(bad)}」`,
          '正确写法是 "key": value',
          this.pos,
        )
      }
      this.pos++
      const value = this.parseValue()
      if (keyNode.type !== 'string') throw new Error('unreachable')
      entries.push({ key: keyNode.value, keyRaw: keyNode.raw, value, start: at })
      this.skipWs()
      const next = this.text[this.pos]
      if (next === ',') {
        this.pos++
        this.skipWs()
        const after = this.text[this.pos]
        if (after === '}') {
          throw this.fail('TRAILING_COMMA', '多了一个逗号：逗号后面紧跟 }', '删除最后一个成员后的逗号（点「修复」可自动移除）')
        }
        if (after === undefined) {
          throw this.fail('INCOMPLETE', '对象还没闭合就到结尾了', '补上缺少的 }')
        }
        continue
      }
      if (next === '}') {
        this.pos++
        return { type: 'object', entries, start, end: this.pos }
      }
      if (next === undefined) {
        throw this.fail('INCOMPLETE', '对象还没闭合就到结尾了', '补上缺少的 }')
      }
      if (next === '"' || isIdentStart(next)) {
        throw this.fail('MISSING_COMMA', '两个属性之间缺少逗号', '在上一个值的后面补一个逗号 ,')
      }
      throw this.fail('UNEXPECTED', `对象的成员之间出现了「${showChar(next)}」`, '成员之间用逗号分隔，最后一个成员后面不要逗号')
    }
  }

  private parseArray(): JsonNode {
    const start = this.pos
    this.pos++ // [
    const items: JsonNode[] = []
    this.skipWs()
    if (this.text[this.pos] === ']') {
      this.pos++
      return { type: 'array', items, start, end: this.pos }
    }
    for (;;) {
      this.skipWs()
      if (this.text[this.pos] === ']') {
        throw this.fail('TRAILING_COMMA', '多了一个逗号：逗号后面紧跟 ]', '删除最后一个元素后的逗号（点「修复」可自动移除）')
      }
      items.push(this.parseValue())
      this.skipWs()
      const next = this.text[this.pos]
      if (next === ',') {
        this.pos++
        this.skipWs()
        const after = this.text[this.pos]
        if (after === ']') {
          throw this.fail('TRAILING_COMMA', '多了一个逗号：逗号后面紧跟 ]', '删除最后一个元素后的逗号（点「修复」可自动移除）')
        }
        if (after === undefined) {
          throw this.fail('INCOMPLETE', '数组还没闭合就到结尾了', '补上缺少的 ]')
        }
        continue
      }
      if (next === ']') {
        this.pos++
        return { type: 'array', items, start, end: this.pos }
      }
      if (next === undefined) {
        throw this.fail('INCOMPLETE', '数组还没闭合就到结尾了', '补上缺少的 ]')
      }
      throw this.fail('MISSING_COMMA', '数组元素之间缺少逗号', '在元素之间补一个逗号 ,')
    }
  }

  private parseString(): JsonNode {
    const start = this.pos
    const quote = this.text[this.pos]
    this.pos++
    let body = ''
    for (;;) {
      const ch = this.text[this.pos]
      if (ch === undefined) {
        throw this.fail('INCOMPLETE', '字符串没有闭合就到结尾了', '补上缺少的双引号 "')
      }
      if (ch === quote) {
        this.pos++
        return {
          type: 'string',
          value: decodeStringBody(body),
          raw: this.text.slice(start, this.pos),
          start,
          end: this.pos,
        }
      }
      if (ch === '\\') {
        const n = this.text[this.pos + 1]
        if (n === undefined) {
          throw this.fail('INCOMPLETE', '字符串以反斜杠结尾，转义不完整', '在反斜杠后面补上要转义的字符')
        }
        if (n === 'u') {
          const hex = this.text.slice(this.pos + 2, this.pos + 6)
          if (hex.length < 4 || [...hex].some((c) => !isHex(c))) {
            throw this.fail('BAD_ESCAPE', `\\u 后面必须是 4 位十六进制数字，这里是「\\u${hex}」`, '例如 \\u4e2d 表示「中」')
          }
          body += '\\u' + hex
          this.pos += 6
          continue
        }
        if (!'"\\/bfnrt'.includes(n)) {
          throw this.fail('BAD_ESCAPE', `非法转义字符「\\${n}」`, 'JSON 只允许 \\" \\\\ \\/ \\b \\f \\n \\r \\t 和 \\uXXXX')
        }
        body += '\\' + n
        this.pos += 2
        continue
      }
      if (ch < ' ') {
        throw this.fail(
          'CONTROL_CHAR',
          `字符串里有未转义的控制字符（${showChar(ch)}）`,
          '换行要写成 \\n，制表符要写成 \\t',
        )
      }
      body += ch
      this.pos++
    }
  }

  private parseNumber(): JsonNode {
    const start = this.pos
    const ch = this.text[this.pos]
    if (ch === '+') {
      throw this.fail('BAD_NUMBER', '数字不能以 + 开头', '把 +1 改成 1（点「修复」可自动处理）')
    }
    if (ch === '-') this.pos++
    if (!isDigit(this.text[this.pos])) {
      throw this.fail('BAD_NUMBER', '负号后面必须是数字', '例如 -1 或 -0.5')
    }
    if (this.text[this.pos] === '0') {
      this.pos++
      if (isDigit(this.text[this.pos])) {
        throw this.fail('BAD_NUMBER', '数字不能有前导零', '把 007 改成 7（点「修复」可自动处理）', start)
      }
    } else {
      while (isDigit(this.text[this.pos])) this.pos++
    }
    if (this.text[this.pos] === '.') {
      this.pos++
      if (!isDigit(this.text[this.pos])) {
        throw this.fail('BAD_NUMBER', '小数点后面必须有数字', '例如 1.0；整数直接写 1')
      }
      while (isDigit(this.text[this.pos])) this.pos++
    }
    const e = this.text[this.pos]
    if (e === 'e' || e === 'E') {
      this.pos++
      if (this.text[this.pos] === '+' || this.text[this.pos] === '-') this.pos++
      if (!isDigit(this.text[this.pos])) {
        throw this.fail('BAD_NUMBER', '科学计数法的指数部分必须是数字', '例如 1e10、1.5E-3')
      }
      while (isDigit(this.text[this.pos])) this.pos++
    }
    const next = this.text[this.pos]
    if (next !== undefined && /[A-Za-z_$]/.test(next)) {
      throw this.fail('BAD_NUMBER', `数字后面跟着非法字符「${next}」`, '数字和单位/字母之间需要用引号包成字符串')
    }
    return { type: 'number', raw: this.text.slice(start, this.pos), start, end: this.pos }
  }

  private parseLiteral(): JsonNode {
    const start = this.pos
    for (const [word, node] of [
      ['true', { type: 'boolean', value: true }],
      ['false', { type: 'boolean', value: false }],
      ['null', { type: 'null' }],
    ] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length
        const next = this.text[this.pos]
        if (next !== undefined && /[A-Za-z0-9_$]/.test(next)) break
        return { ...node, start, end: this.pos } as JsonNode
      }
    }
    throw this.fail(
      'BAD_LITERAL',
      `无法识别的字面量「${this.peekWord()}」`,
      'JSON 只有 true、false、null 三个字面量；None/True/undefined 都不合法（点「修复」可自动转换）',
    )
  }
}

export function parseJson(text: string): ParseResult {
  return new Parser(text).run()
}

/** 把错误格式化成一行易读文案，例如「第 3 行第 12 列」 */
export function formatErrorLocation(error: JsonError): string {
  return `第 ${error.line} 行第 ${error.column} 列`
}
