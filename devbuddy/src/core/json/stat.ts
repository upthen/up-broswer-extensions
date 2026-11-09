import type { JsonNode, JsonStats } from './types'

/** 统计节点数、层级、类型分布 */
export function collectStats(root: JsonNode, source: string): JsonStats {
  const stats: JsonStats = {
    chars: source.length,
    lines: source === '' ? 0 : source.split(/\r\n|\r|\n/).length,
    bytes: new TextEncoder().encode(source).length,
    nodes: 0,
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    depth: 0,
  }

  const walk = (node: JsonNode, depth: number) => {
    stats.nodes++
    stats.depth = Math.max(stats.depth, depth)
    switch (node.type) {
      case 'object':
        stats.objects++
        for (const e of node.entries) walk(e.value, depth + 1)
        break
      case 'array':
        stats.arrays++
        for (const item of node.items) walk(item, depth + 1)
        break
      case 'string':
        stats.strings++
        break
      case 'number':
        stats.numbers++
        break
      case 'boolean':
        stats.booleans++
        break
      case 'null':
        stats.nulls++
        break
    }
  }

  walk(root, 1)
  return stats
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
