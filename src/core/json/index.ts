import { parseJson } from './parser'
import { serialize, indentUnit } from './serialize'
import type { IndentOption, SortDirection } from './serialize'
import { collectStats } from './stat'
import { escapeJsonText, unescapeJsonText } from './escape'
import { repairJsonText } from './repair'
import type { JsonError, JsonStats } from './types'

export type { IndentOption, SortDirection } from './serialize'
export type { JsonError, JsonStats, JsonNode } from './types'
export { parseJson } from './parser'
export { repairJsonText } from './repair'
export type { RepairChange, RepairResult } from './repair'
export { collectStats, formatBytes } from './stat'
export { escapeJsonText, unescapeJsonText } from './escape'
export { serialize, indentUnit } from './serialize'

export type JsonOpResult =
  | { ok: true; output: string; stats: JsonStats }
  | { ok: false; error: JsonError; stats?: JsonStats; partial?: string }

export function formatJsonText(
  text: string,
  indent: IndentOption,
  sort: SortDirection | null = null,
): JsonOpResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return {
    ok: true,
    output: serialize(parsed.root, { indent, sort }),
    stats: collectStats(parsed.root, text),
  }
}

export function minifyJsonText(text: string): JsonOpResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return {
    ok: true,
    output: serialize(parsed.root, { indent: 2, compact: true }),
    stats: collectStats(parsed.root, text),
  }
}

export function validateJsonText(text: string): JsonOpResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return {
    ok: true,
    output: '',
    stats: collectStats(parsed.root, text),
  }
}

/** 转义：输入原文 → 转义后的字符串体；反转义：还原 */
export function escapeTransform(text: string, mode: 'escape' | 'unescape'): JsonOpResult {
  if (mode === 'escape') {
    return {
      ok: true,
      output: escapeJsonText(text),
      stats: {
        chars: text.length,
        lines: text.split(/\r\n|\r|\n/).length,
        bytes: new TextEncoder().encode(text).length,
        nodes: 0,
        objects: 0,
        arrays: 0,
        strings: 0,
        numbers: 0,
        booleans: 0,
        nulls: 0,
        depth: 0,
      },
    }
  }
  const result = unescapeJsonText(text)
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: 'BAD_ESCAPE',
        index: 0,
        line: 1,
        column: 1,
        message: result.message,
        hint: '检查反斜杠后面的转义序列是否完整',
      },
    }
  }
  return {
    ok: true,
    output: result.value,
    stats: collectStats({ type: 'null', start: 0, end: 0 }, text),
  }
}

export { repairJsonText as repair }
export { indentUnit as getIndentUnit }
