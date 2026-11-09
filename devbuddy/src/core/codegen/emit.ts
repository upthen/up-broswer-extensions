import type { Schema, SchemaField, PrimitiveKind } from './infer'

export type CodeLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust'

export interface CodegenOptions {
  language: CodeLanguage
  rootName: string
  /** TS 导出 / Rust pub */
  exportType: boolean
  /** 数组样本里缺失的字段标记为可选 */
  optionalFields: boolean
  /** Go 的 json tag 加 omitempty */
  omitempty: boolean
  /** 把 null 体现到类型里（TS null / Python Optional / Rust Option） */
  nullable: boolean
  indent: 2 | 4
}

export const DEFAULT_CODEGEN_OPTIONS: CodegenOptions = {
  language: 'typescript',
  rootName: 'Root',
  exportType: true,
  optionalFields: true,
  omitempty: true,
  nullable: true,
  indent: 2,
}

export const LANGUAGES: { value: CodeLanguage; label: string; ext: string }[] = [
  { value: 'typescript', label: 'TypeScript', ext: 'ts' },
  { value: 'go', label: 'Go', ext: 'go' },
  { value: 'java', label: 'Java', ext: 'java' },
  { value: 'python', label: 'Python', ext: 'py' },
  { value: 'rust', label: 'Rust', ext: 'rs' },
]

export interface Declaration {
  name: string
  fields: SchemaField[]
}

export interface NamedTypes {
  decls: Declaration[]
  nameOf: (schema: Schema) => string | undefined
}

const RESERVED: Record<CodeLanguage, Set<string>> = {
  typescript: new Set(['class', 'interface', 'enum', 'function', 'var', 'let', 'const', 'new', 'delete', 'typeof', 'default', 'export', 'import', 'extends', 'implements', 'private', 'public', 'static', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'this', 'super', 'null', 'true', 'false', 'any', 'unknown', 'number', 'string', 'boolean']),
  go: new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']),
  java: new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'record', 'var']),
  python: new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'dataclass', 'str', 'int', 'list', 'dict']),
  rust: new Set(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while']),
}

function words(raw: string): string[] {
  const cleaned = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^0-9A-Za-z\u4e00-\u9fa5]+/g, ' ')
    .trim()
  const list = cleaned.split(/\s+/).filter(Boolean)
  // 中文键名无法转成标识符，交给调用方按序号兜底
  return list.filter((w) => /^[0-9A-Za-z]/.test(w))
}

export function pascalCase(raw: string, fallback = 'Field'): string {
  const list = words(raw)
  if (!list.length) return fallback
  const name = list.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  const finalName = /^[0-9]/.test(name) ? `N${name}` : name
  const cap = finalName[0].toUpperCase() + finalName.slice(1)
  return cap || fallback
}

export function camelCase(raw: string, fallback = 'field'): string {
  const cap = pascalCase(raw, 'Field')
  return cap === 'Field' && !/^[0-9A-Za-z]/.test(raw) ? fallback : cap[0].toLowerCase() + cap.slice(1)
}

export function snakeCase(raw: string, fallback = 'field'): string {
  const list = words(raw)
  if (!list.length) return fallback
  const name = list
    .map((w) => w.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
    .join('_')
  const safe = /^[0-9]/.test(name) ? `f_${name}` : name
  return RESERVED.python.has(safe) ? `${safe}_` : safe
}

function singularize(name: string): string {
  if (/ies$/i.test(name)) return name.slice(0, -3) + 'y'
  if (/sses$/i.test(name)) return name.slice(0, -2)
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1)
  return `${name}Item`
}

/** 为每个对象结构分配唯一类型名，并给出「根 → 子」的声明顺序 */
export function collectDeclarations(root: Schema, rootName: string): NamedTypes {
  const decls: Declaration[] = []
  const names = new Map<Schema, string>()
  const used = new Set<string>()

  const unique = (suggested: string): string => {
    let name = suggested || 'Root'
    let i = 2
    while (used.has(name)) name = `${suggested}${i++}`
    used.add(name)
    return name
  }

  const visit = (schema: Schema, suggested: string): void => {
    if (schema.objectFields) {
      const name = unique(suggested)
      names.set(schema, name)
      decls.push({ name, fields: schema.objectFields })
      for (const field of schema.objectFields) visit(field.schema, pascalCase(field.key))
    }
    if (schema.arrayItems) visit(schema.arrayItems, singularize(suggested))
  }

  visit(root, pascalCase(rootName, 'Root'))
  return { decls, nameOf: (schema) => names.get(schema) }
}

function scalar(kind: string, lang: CodeLanguage): string {
  switch (kind) {
    case 'string':
      return lang === 'go' ? 'string' : lang === 'java' ? 'String' : lang === 'python' ? 'str' : lang === 'rust' ? 'String' : 'string'
    case 'integer':
      return lang === 'go' ? 'int64' : lang === 'java' ? 'long' : lang === 'python' ? 'int' : lang === 'rust' ? 'i64' : 'number'
    case 'number':
      return lang === 'go' ? 'float64' : lang === 'java' ? 'double' : lang === 'python' ? 'float' : lang === 'rust' ? 'f64' : 'number'
    case 'boolean':
      return lang === 'go' ? 'bool' : lang === 'java' ? 'boolean' : lang === 'python' ? 'bool' : lang === 'rust' ? 'bool' : 'boolean'
    default:
      return lang === 'go' ? 'interface{}' : lang === 'java' ? 'Object' : lang === 'python' ? 'Any' : lang === 'rust' ? 'serde_json::Value' : 'unknown'
  }
}

function arrayType(item: string, lang: CodeLanguage): string {
  switch (lang) {
    case 'typescript':
      return `${item.includes(' | ') ? `(${item})` : item}[]`
    case 'go':
      return `[]${item}`
    case 'java':
      return `List<${item}>`
    case 'python':
      return `List[${item}]`
    case 'rust':
      return `Vec<${item}>`
  }
}

export function renderType(
  schema: Schema,
  lang: CodeLanguage,
  named: NamedTypes,
  options: CodegenOptions,
): string {
  const parts: string[] = []
  const order: PrimitiveKind[] = ['string', 'integer', 'number', 'boolean', 'unknown']
  for (const kind of order) {
    if (schema.primitives.includes(kind)) parts.push(scalar(kind, lang))
  }
  if (schema.objectFields) parts.push(named.nameOf(schema) ?? 'Any')
  if (schema.arrayItems) parts.push(arrayType(renderType(schema.arrayItems, lang, named, options), lang))
  // 只见过的取值全是 null：直接给 null 类型，别输出「unknown | null」这种噪音
  if (!parts.length) {
    if (options.nullable && schema.nullable) return lang === 'typescript' ? 'null' : scalar('unknown', lang)
    parts.push(scalar('unknown', lang))
  }

  let type: string
  const uniqueParts = [...new Set(parts)]
  if (uniqueParts.length === 1) type = uniqueParts[0]
  else if (lang === 'typescript') type = uniqueParts.join(' | ')
  else if (lang === 'python') type = `Union[${uniqueParts.join(', ')}]`
  else if (lang === 'rust') type = 'serde_json::Value'
  else if (lang === 'go') type = 'interface{}'
  else type = 'Object'

  const nullable = options.nullable && schema.nullable
  if (nullable) {
    if (lang === 'typescript') type += ' | null'
    else if (lang === 'python') type = `Optional[${type}]`
    else if (lang === 'rust') type = `Option<${type}>`
    else if (lang === 'go') type = uniqueParts.length === 1 ? `*${type}` : 'interface{}'
    // Java 使用包装类型，null 天然可承载，字段上补注释
  }
  return type
}

function uniqueFieldNames(fields: SchemaField[], make: (key: string) => string): string[] {
  const used = new Set<string>()
  return fields.map((field) => {
    let name = make(field.key)
    let i = 2
    while (used.has(name)) name = `${make(field.key)}${i++}`
    used.add(name)
    return name
  })
}

function pad(options: CodegenOptions, level = 1): string {
  return ' '.repeat(options.indent * level)
}

function emitTypeScript(root: Schema, named: NamedTypes, options: CodegenOptions, code: string[]): void {
  if (!named.decls.length) {
    code.push(`${options.exportType ? 'export ' : ''}type ${pascalCase(options.rootName, 'Root')} = ${renderType(root, 'typescript', named, options)};`)
    return
  }
  named.decls.forEach((decl, index) => {
    if (index) code.push('')
    code.push(`${options.exportType ? 'export ' : ''}interface ${decl.name} {`)
    const fieldNames = uniqueFieldNames(decl.fields, (key) => key)
    decl.fields.forEach((field, i) => {
      const optional = options.optionalFields && field.optional
      const key = /^[A-Za-z_$][\w$]*$/.test(fieldNames[i]) ? fieldNames[i] : JSON.stringify(fieldNames[i])
      const type = renderType(field.schema, 'typescript', named, options)
      code.push(`${pad(options)}${key}${optional ? '?' : ''}: ${type};`)
    })
    code.push('}')
  })
}

function emitGo(root: Schema, named: NamedTypes, options: CodegenOptions, code: string[]): void {
  code.push('package model', '')
  if (!named.decls.length) {
    code.push(`type ${pascalCase(options.rootName, 'Root')} ${renderType(root, 'go', named, options)}`)
    return
  }
  named.decls.forEach((decl, index) => {
    if (index) code.push('')
    code.push(`type ${decl.name} struct {`)
    const fieldNames = uniqueFieldNames(decl.fields, (key) => pascalCase(key))
    decl.fields.forEach((field, i) => {
      const optional = options.optionalFields && field.optional
      const omit = options.omitempty && optional ? ',omitempty' : ''
      const type = renderType(field.schema, 'go', named, options)
      code.push(`${pad(options)}${fieldNames[i]} ${type} \`json:"${field.key.replace(/"/g, '\\"')}${omit}"\``)
    })
    code.push('}')
  })
}

function boxed(type: string): string {
  const map: Record<string, string> = { long: 'Long', double: 'Double', boolean: 'Boolean', int: 'Integer' }
  return map[type] ?? type
}

function javaFieldType(field: SchemaField, named: NamedTypes, options: CodegenOptions): string {
  const type = renderType(field.schema, 'java', named, options)
  return options.nullable && field.schema.nullable ? boxed(type) : type
}

function emitJava(root: Schema, named: NamedTypes, options: CodegenOptions, code: string[]): void {
  const anyList = named.decls.some((d) => d.fields.some((f) => javaFieldType(f, named, options).includes('List<')))
  if (anyList) code.push('import java.util.List;', '')
  if (!named.decls.length) {
    code.push(`// 根值类型为 ${renderType(root, 'java', named, options)}，Java 无法为标量定义类型别名`)
    return
  }
  named.decls.forEach((decl, index) => {
    if (index) code.push('')
    code.push('public class ' + decl.name + ' {')
    const fieldNames = uniqueFieldNames(decl.fields, (key) => {
      const name = camelCase(key)
      return RESERVED.java.has(name) ? `${name}Value` : name
    })
    decl.fields.forEach((field, i) => {
      const type = javaFieldType(field, named, options)
      const note = [
        options.optionalFields && field.optional ? 'optional' : '',
        options.nullable && field.schema.nullable ? 'nullable' : '',
      ]
        .filter(Boolean)
        .join(' / ')
      code.push(`${pad(options)}private ${type} ${fieldNames[i]};${note ? ` // ${note}` : ''}`)
    })
    decl.fields.forEach((field, i) => {
      const type = javaFieldType(field, named, options)
      const name = fieldNames[i]
      const cap = name[0].toUpperCase() + name.slice(1)
      code.push('')
      code.push(`${pad(options)}public ${type} get${cap}() { return this.${name}; }`)
      code.push(`${pad(options)}public void set${cap}(${type} ${name}) { this.${name} = ${name}; }`)
    })
    code.push('}')
  })
}

function emitPython(root: Schema, named: NamedTypes, options: CodegenOptions, code: string[]): void {
  const lines: string[] = []
  if (!named.decls.length) {
    lines.push(`${pascalCase(options.rootName, 'Root')} = ${renderType(root, 'python', named, options)}`)
  } else {
    named.decls.forEach((decl, index) => {
      if (index) lines.push('', '')
      lines.push('@dataclass')
      lines.push(`class ${decl.name}:`)
      const fieldNames = uniqueFieldNames(decl.fields, (key) => snakeCase(key))
      const fields = decl.fields.map((field, i) => {
        const optional = options.optionalFields && field.optional
        let type = renderType(field.schema, 'python', named, options)
        if (optional && !type.startsWith('Optional[')) type = `Optional[${type}]`
        return { name: fieldNames[i], type, optional }
      })
      // dataclass 规定：有默认值的字段必须排在没有默认值的字段之后
      const ordered = [...fields.filter((f) => !f.optional), ...fields.filter((f) => f.optional)]
      if (!ordered.length) lines.push(`${pad(options)}pass`)
      for (const field of ordered) {
        lines.push(`${pad(options)}${field.name}: ${field.type}${field.optional ? ' = None' : ''}`)
      }
    })
  }
  const body = lines.join('\n')
  const imports = ['from __future__ import annotations', 'from dataclasses import dataclass']
  const typing = ['Any', 'List', 'Optional', 'Union'].filter((t) =>
    t === 'Any' ? /\bAny\b/.test(body) : body.includes(`${t}[`),
  )
  if (typing.length) imports.push(`from typing import ${typing.join(', ')}`)
  code.push(...imports, '', '', body)
}

function emitRust(root: Schema, named: NamedTypes, options: CodegenOptions, code: string[]): void {
  code.push('use serde::{Deserialize, Serialize};')
  const lines: string[] = []
  if (!named.decls.length) {
    lines.push(`pub type ${pascalCase(options.rootName, 'Root')} = ${renderType(root, 'rust', named, options)};`)
  } else {
    named.decls.forEach((decl, index) => {
      if (index) lines.push('')
      lines.push('#[derive(Debug, Clone, Serialize, Deserialize)]')
      lines.push(`${options.exportType ? 'pub ' : ''}struct ${decl.name} {`)
      const fieldNames = uniqueFieldNames(decl.fields, (key) => {
        const name = snakeCase(key)
        return RESERVED.rust.has(name) ? `${name}_` : name
      })
      decl.fields.forEach((field, i) => {
        const optional = options.optionalFields && field.optional
        let type = renderType(field.schema, 'rust', named, options)
        if (optional && !type.startsWith('Option<')) type = `Option<${type}>`
        const name = fieldNames[i]
        if (name !== field.key) lines.push(`${pad(options)}#[serde(rename = "${field.key.replace(/"/g, '\\"')}")]`)
        if (type.startsWith('Option<')) lines.push(`${pad(options)}#[serde(default, skip_serializing_if = "Option::is_none")]`)
        lines.push(`${pad(options)}${options.exportType ? 'pub ' : ''}${name}: ${type},`)
      })
      lines.push('}')
    })
  }
  const body = lines.join('\n')
  code.push('', body)
}

/** 把 JSON 值渲染成目标语言的类型定义（纯字符串，无 DOM / eval） */
export function emitCode(root: Schema, rootName: string, options: CodegenOptions): string {
  const named = collectDeclarations(root, rootName)
  const code: string[] = []
  switch (options.language) {
    case 'typescript':
      emitTypeScript(root, named, options, code)
      break
    case 'go':
      emitGo(root, named, options, code)
      break
    case 'java':
      emitJava(root, named, options, code)
      break
    case 'python':
      emitPython(root, named, options, code)
      break
    case 'rust':
      emitRust(root, named, options, code)
      break
  }
  return code.join('\n') + '\n'
}
