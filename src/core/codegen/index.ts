import { inferSchema, countObjectSchemas } from './infer'
import { emitCode, DEFAULT_CODEGEN_OPTIONS, LANGUAGES } from './emit'
import type { CodegenOptions, CodeLanguage } from './emit'
import type { JsonValue } from '../json/value'

export type { CodegenOptions, CodeLanguage }
export { inferSchema, countObjectSchemas, emitCode, DEFAULT_CODEGEN_OPTIONS, LANGUAGES }

export interface CodegenResult {
  code: string
  typeCount: number
  language: CodeLanguage
  extension: string
}

/** 从 JSON 值生成类型定义。核心链路：推断 → 命名 → 按语言渲染，全是纯函数 */
export function generateCode(value: JsonValue, options: Partial<CodegenOptions> = {}): CodegenResult {
  const merged: CodegenOptions = { ...DEFAULT_CODEGEN_OPTIONS, ...options }
  const schema = inferSchema(value)
  return {
    code: emitCode(schema, merged.rootName || 'Root', merged),
    typeCount: countObjectSchemas(schema),
    language: merged.language,
    extension: LANGUAGES.find((l) => l.value === merged.language)?.ext ?? 'txt',
  }
}
