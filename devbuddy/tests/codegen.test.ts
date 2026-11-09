import { describe, expect, it } from 'vitest'
import { generateCode, inferSchema, countObjectSchemas, LANGUAGES } from '../src/core/codegen'
import type { CodeLanguage } from '../src/core/codegen'
import type { JsonValue } from '../src/core/json/value'

const sample: JsonValue = {
  name: 'DevBuddy',
  version: '0.1.0',
  downloads: 12800,
  rating: 4.9,
  offline: true,
  tags: ['json', 'dev'],
  author: { name: 'yongbo', email: null },
  contacts: [{ phone: '138' }, { phone: null }],
  features: [
    { id: 1, title: '格式化', enabled: true },
    { id: 2, title: '修复', enabled: false, hint: null },
  ],
  'user-name': 'yongbo',
  empty: [],
  nothing: null,
}

describe('结构推断', () => {
  it('标量类型与空数组', () => {
    expect(inferSchema('hi')).toEqual({ primitives: ['string'], nullable: false })
    expect(inferSchema(1)).toEqual({ primitives: ['integer'], nullable: false })
    expect(inferSchema(1.5)).toEqual({ primitives: ['number'], nullable: false })
    expect(inferSchema(false)).toEqual({ primitives: ['boolean'], nullable: false })
    expect(inferSchema(null)).toEqual({ primitives: [], nullable: true })
    expect(inferSchema([]).arrayItems?.primitives).toEqual(['unknown'])
  })

  it('数组内对象合并：缺失字段变可选', () => {
    const schema = inferSchema(sample)
    const features = schema.objectFields?.find((f) => f.key === 'features')?.schema.arrayItems
    expect(features?.objectFields?.map((f) => [f.key, f.optional])).toEqual([
      ['id', false],
      ['title', false],
      ['enabled', false],
      ['hint', true],
    ])
  })

  it('混合类型合并为并集，int 与 float 归一', () => {
    const schema = inferSchema([1, 2.5, 'x', null] as JsonValue)
    expect(schema.arrayItems?.primitives).toEqual(['string', 'number'])
    expect(schema.arrayItems?.nullable).toBe(true)
  })

  it('类型数量统计', () => {
    expect(countObjectSchemas(inferSchema(sample))).toBe(4) // Root / Author / Contact / Feature
  })
})

describe('TypeScript 生成', () => {
  it('导出 interface，字段与数组类型正确', () => {
    const { code } = generateCode(sample)
    expect(code).toContain('export interface Root {')
    expect(code).toContain('name: string;')
    expect(code).toContain('downloads: number;')
    expect(code).toContain('rating: number;')
    expect(code).toContain('tags: string[];')
    expect(code).toContain('offline: boolean;')
    expect(code).toContain('"user-name": string;')
  })

  it('null 与可选字段', () => {
    const { code } = generateCode(sample)
    expect(code).toContain('email: null;')
    expect(code).toContain('phone: string | null;')
    expect(code).toContain('nothing: null;')
    expect(code).toContain('hint?: null;')
  })

  it('关闭 export / 可选字段 / 自定义根名', () => {
    const { code } = generateCode(sample, { rootName: 'AppConfig', exportType: false, optionalFields: false })
    expect(code).toContain('interface AppConfig {')
    expect(code).not.toContain('export interface')
    expect(code).not.toContain('hint?:')
  })

  it('根是标量时给类型别名', () => {
    expect(generateCode('hello').code).toContain('export type Root = string;')
    expect(generateCode([1, 2]).code).toContain('number[]')
  })

  it('缩进 4 空格', () => {
    expect(generateCode(sample, { indent: 4 }).code).toContain('    name: string;')
  })
})

describe('其他语言生成', () => {
  const cases: { lang: CodeLanguage; expect: string[] }[] = [
    { lang: 'go', expect: ['package model', 'type Root struct {', 'json:"name"', '[]string', '*string'] },
    { lang: 'java', expect: ['public class Root {', 'private String name;', 'public String getName()', 'List<String>'] },
    { lang: 'python', expect: ['from dataclasses import dataclass', '@dataclass', 'class Root:', 'name: str', 'Optional[str]'] },
    { lang: 'rust', expect: ['use serde::{Deserialize, Serialize};', 'pub struct Root {', 'pub name: String,', '#[serde(rename = "user-name")]'] },
  ]

  for (const { lang, expect: expectations } of cases) {
    it(`${lang} 关键结构齐全`, () => {
      const { code } = generateCode(sample, { language: lang })
      for (const text of expectations) expect(code, `${lang} 缺少 ${text}`).toContain(text)
    })
  }

  it('Go omitempty 开关生效', () => {
    expect(generateCode(sample, { language: 'go' }).code).toContain('omitempty')
    expect(generateCode(sample, { language: 'go', omitempty: false }).code).not.toContain('omitempty')
  })

  it('Python 有默认值的字段排在后面', () => {
    const code = generateCode(sample, { language: 'python' }).code
    const body = code.slice(code.indexOf('class Feature:'))
    expect(body.indexOf('title: str')).toBeLessThan(body.indexOf('hint:'))
    expect(body).toContain('= None')
  })

  it('每种语言与扩展名一一对应', () => {
    for (const lang of LANGUAGES) {
      const result = generateCode(sample, { language: lang.value })
      expect(result.extension).toBe(lang.ext)
      expect(result.code.length).toBeGreaterThan(40)
      expect(result.typeCount).toBe(4)
    }
  })

  it('中文键名不产生非法标识符', () => {
    const code = generateCode({ 用户名: 'x', 年龄: 18 }, { language: 'rust' }).code
    expect(code).toContain('#[serde(rename = "用户名")]')
    expect(code).toContain('pub field')
  })

  it('空对象与嵌套数组', () => {
    expect(generateCode({}).code).toContain('export interface Root {\n}')
    expect(generateCode({ matrix: [[1, 2], [3]] }).code).toContain('matrix: number[][];')
  })
})
