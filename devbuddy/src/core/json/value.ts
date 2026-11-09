import type { JsonNode } from './types'

/** 供树形视图 / JSONPath / 代码生成使用的普通 JS 值 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** AST → 普通 JS 值。数字按原始字面量转 number（超大数可能失精，仅影响查询/代码生成的类型判断） */
export function toJsValue(node: JsonNode): JsonValue {
  switch (node.type) {
    case 'object': {
      const obj: { [key: string]: JsonValue } = {}
      for (const entry of node.entries) obj[entry.key] = toJsValue(entry.value)
      return obj
    }
    case 'array':
      return node.items.map(toJsValue)
    case 'string':
      return node.value
    case 'number':
      return Number(node.raw)
    case 'boolean':
      return node.value
    case 'null':
      return null
  }
}

export function typeLabel(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return Number.isInteger(value) ? 'int' : 'float'
    case 'boolean':
      return 'boolean'
    default:
      return 'unknown'
  }
}

/** 单行预览，用于树形节点与查询结果 */
export function preview(value: JsonValue, max = 56): string {
  let text: string
  if (value === null) text = 'null'
  else if (Array.isArray(value)) text = `Array(${value.length})`
  else if (typeof value === 'object') text = `Object{${Object.keys(value).length}}`
  else if (typeof value === 'string') text = JSON.stringify(value)
  else text = String(value)
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object'
}

/** 规范化 JSONPath，键名一律用 ['xxx']，数组下标用 [n] */
export function childPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`
  const escaped = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `${base}['${escaped}']`
}
