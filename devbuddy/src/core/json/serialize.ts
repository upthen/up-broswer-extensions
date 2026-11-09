import type { JsonEntry, JsonNode } from './types'

export type IndentOption = 2 | 4 | 'tab'
export type SortDirection = 'asc' | 'desc'

export interface SerializeOptions {
  indent: IndentOption
  /** 键排序方向；不传则保持原始顺序 */
  sort?: SortDirection | null
  /** 压缩成单行（忽略缩进） */
  compact?: boolean
}

export function indentUnit(indent: IndentOption): string {
  return indent === 'tab' ? '\t' : ' '.repeat(indent)
}

function compareEntries(a: JsonEntry, b: JsonEntry): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * 序列化 AST。刻意保留 number / string 的原始字面量，
 * 避免 1.0 / 1e3 / \u4e2d 这类内容被 JS 的 JSON.parse 改写。
 */
export function serialize(root: JsonNode, opts: SerializeOptions): string {
  const unit = opts.compact ? '' : indentUnit(opts.indent)
  const nl = unit ? '\n' : ''
  const colon = unit ? ': ' : ':'

  const emit = (node: JsonNode, depth: number): string => {
    switch (node.type) {
      case 'object': {
        if (node.entries.length === 0) return '{}'
        const pad = unit.repeat(depth + 1)
        const closePad = unit.repeat(depth)
        let entries = node.entries
        if (opts.sort) {
          entries = [...entries].sort(compareEntries)
          if (opts.sort === 'desc') entries = entries.reverse()
        }
        const body = entries.map((e) => pad + e.keyRaw + colon + emit(e.value, depth + 1)).join(',' + nl)
        return '{' + nl + body + nl + closePad + '}'
      }
      case 'array': {
        if (node.items.length === 0) return '[]'
        const pad = unit.repeat(depth + 1)
        const closePad = unit.repeat(depth)
        const body = node.items.map((item) => pad + emit(item, depth + 1)).join(',' + nl)
        return '[' + nl + body + nl + closePad + ']'
      }
      case 'string':
        return node.raw
      case 'number':
        return node.raw
      case 'boolean':
        return node.value ? 'true' : 'false'
      case 'null':
        return 'null'
    }
  }

  return emit(root, 0)
}
