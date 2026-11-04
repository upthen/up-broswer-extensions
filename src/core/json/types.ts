/** JSON AST：保留原始字面量（raw），保证格式化时数字/转义字符不被改写 */
export type JsonNode =
  | { type: 'object'; entries: JsonEntry[]; start: number; end: number }
  | { type: 'array'; items: JsonNode[]; start: number; end: number }
  | { type: 'string'; value: string; raw: string; start: number; end: number }
  | { type: 'number'; raw: string; start: number; end: number }
  | { type: 'boolean'; value: boolean; start: number; end: number }
  | { type: 'null'; start: number; end: number }

export interface JsonEntry {
  /** 解码后的键名 */
  key: string
  /** 原始键字面量（含引号） */
  keyRaw: string
  value: JsonNode
  start: number
}

export type JsonErrorCode =
  | 'EMPTY'
  | 'INCOMPLETE'
  | 'UNEXPECTED'
  | 'TRAILING_CONTENT'
  | 'SINGLE_QUOTE'
  | 'UNQUOTED_KEY'
  | 'TRAILING_COMMA'
  | 'MISSING_COMMA'
  | 'MISSING_COLON'
  | 'BAD_NUMBER'
  | 'BAD_ESCAPE'
  | 'CONTROL_CHAR'
  | 'BAD_LITERAL'
  | 'COMMENT'

export interface JsonError {
  code: JsonErrorCode
  /** 字符下标 */
  index: number
  /** 1 基行号 */
  line: number
  /** 1 基列号 */
  column: number
  message: string
  hint?: string
  /** 出错位置附近的一小段原文，用于 UI 展示 */
  snippet?: string
}

export type ParseResult =
  | { ok: true; root: JsonNode }
  | { ok: false; error: JsonError }

export interface JsonStats {
  chars: number
  lines: number
  bytes: number
  nodes: number
  objects: number
  arrays: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  depth: number
}
