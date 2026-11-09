import { describe, expect, it } from 'vitest'
import { parseJson } from '../src/core/json/parser'
import { serialize } from '../src/core/json/serialize'
import { collectStats } from '../src/core/json/stat'
import { escapeJsonText, unescapeJsonText } from '../src/core/json/escape'
import { repairJsonText } from '../src/core/json/repair'
import { formatJsonText, minifyJsonText } from '../src/core/json'

const sample = '{"b":1,"a":[{"y":true,"x":null}],"c":"中文"}'

function parseOk(text: string) {
  const r = parseJson(text)
  if (!r.ok) throw new Error(`期望通过解析，实际报错：${r.error.message} @${r.error.line}:${r.error.column}`)
  return r.root
}

function expectError(text: string, code: string) {
  const r = parseJson(text)
  expect(r.ok, `期望报错 ${code}，实际解析成功`).toBe(false)
  if (!r.ok) {
    expect(r.error.code).toBe(code)
    expect(r.error.message.length).toBeGreaterThan(0)
  }
}

describe('parser', () => {
  it('解析基本结构', () => {
    const root = parseOk(sample)
    expect(root.type).toBe('object')
    expect(collectStats(root, sample).objects).toBe(2)
  })

  it('空内容报 EMPTY', () => expectError('   \n\t ', 'EMPTY'))
  it('尾部多余内容', () => expectError('{"a":1} abc', 'TRAILING_CONTENT'))
  it('尾逗号（对象）', () => expectError('{"a":1,}', 'TRAILING_COMMA'))
  it('尾逗号（数组）', () => expectError('[1,2,]', 'TRAILING_COMMA'))
  it('单引号', () => expectError("{'a':1}", 'SINGLE_QUOTE'))
  it('属性名没引号', () => expectError('{a:1}', 'UNQUOTED_KEY'))
  it('缺冒号', () => expectError('{"a" 1}', 'MISSING_COLON'))
  it('缺逗号', () => expectError('{"a":1 "b":2}', 'MISSING_COMMA'))
  it('数字前导零', () => expectError('{"a":007}', 'BAD_NUMBER'))
  it('数字以加号开头', () => expectError('{"a":+1}', 'BAD_NUMBER'))
  it('非法转义', () => expectError('"a\\qb"', 'BAD_ESCAPE'))
  it('字符串内裸换行', () => expectError('"a\nb"', 'CONTROL_CHAR'))
  it('注释', () => expectError('{"a":1} // x', 'COMMENT'))
  it('未闭合', () => expectError('{"a":1', 'INCOMPLETE'))
  it('错误定位准确', () => {
    const r = parseJson('{\n  "a": 1,\n  "b" 2\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(3)
      expect(r.error.column).toBeGreaterThan(5)
    }
  })
})

describe('serialize', () => {
  it('2 空格缩进', () => {
    expect(serialize(parseOk('{"a":1}'), { indent: 2 })).toBe('{\n  "a": 1\n}')
  })
  it('4 空格缩进', () => {
    expect(serialize(parseOk('{"a":1}'), { indent: 4 })).toBe('{\n    "a": 1\n}')
  })
  it('Tab 缩进', () => {
    expect(serialize(parseOk('[1]'), { indent: 'tab' })).toBe('[\n\t1\n]')
  })
  it('保留数字原始字面量', () => {
    expect(serialize(parseOk('[1.0, 1e3, -0.50]'), { indent: 2, compact: true })).toBe('[1.0,1e3,-0.50]')
  })
  it('保留字符串原始转义', () => {
    expect(serialize(parseOk('["\\u4e2d"]'), { indent: 2, compact: true })).toBe('["\\u4e2d"]')
  })
  it('保留键的原始顺序', () => {
    expect(serialize(parseOk('{"z":1,"a":2}'), { indent: 2, compact: true })).toBe('{"z":1,"a":2}')
  })
  it('空对象/空数组', () => {
    expect(serialize(parseOk('{}'), { indent: 2 })).toBe('{}')
    expect(serialize(parseOk('[]'), { indent: 2 })).toBe('[]')
  })
  it('升序排序（递归）', () => {
    expect(serialize(parseOk(sample), { indent: 2, compact: true, sort: 'asc' })).toBe(
      '{"a":[{"x":null,"y":true}],"b":1,"c":"中文"}',
    )
  })
  it('降序排序', () => {
    expect(serialize(parseOk('{"a":1,"c":3,"b":2}'), { indent: 2, compact: true, sort: 'desc' })).toBe(
      '{"c":3,"b":2,"a":1}',
    )
  })
})

describe('stat', () => {
  it('统计节点与深度', () => {
    const stats = collectStats(parseOk(sample), sample)
    expect(stats.nodes).toBe(7)
    expect(stats.depth).toBe(4)
    expect(stats.objects).toBe(2)
    expect(stats.arrays).toBe(1)
    expect(stats.strings).toBe(1)
  })
})

describe('escape', () => {
  it('添加转义不含外层引号', () => {
    expect(escapeJsonText('{"a":"x"}')).toBe('{\\"a\\":\\"x\\"}')
    expect(escapeJsonText('a\nb')).toBe('a\\nb')
  })
  it('移除转义可还原', () => {
    const raw = '{\n  "a": "中"\n}'
    const escaped = escapeJsonText(raw)
    const back = unescapeJsonText(escaped)
    expect(back.ok && back.value).toBe(raw)
  })
  it('非法转义报错', () => {
    const r = unescapeJsonText('a\\qb')
    expect(r.ok).toBe(false)
  })
})

describe('repair', () => {
  const cases: Array<[string, string]> = [
    ['{"a":1,}', '尾逗号'],
    ["{'a':1}", '单引号'],
    ['{a:1}', '属性名裸写'],
    ['// 注释\n{"a":1}', '行注释'],
    ['{"a":1 /* c */}', '块注释'],
    ['{"a":007}', '前导零'],
    ['{"a":True,"b":None}', 'Python 字面量'],
    ['﻿{"a":1}', 'BOM'],
    ['const data = {"a":1};', '前后包裹'],
    ['{“a”：1}', '全角标点'],
    ['{"a":"line1\nline2"}', '字符串内换行'],
  ]

  for (const [input, label] of cases) {
    it(`修复：${label}`, () => {
      const r = repairJsonText(input)
      expect(r.ok, `${label} 修复失败：${r.ok ? '' : r.error.message}`).toBe(true)
      if (r.ok) {
        expect(parseJson(r.text).ok).toBe(true)
      }
    })
  }

  it('合法 JSON 不产生改动', () => {
    const r = repairJsonText('{"a":1}')
    expect(r.ok && r.alreadyValid).toBe(true)
    expect(r.ok && r.changes.length).toBe(0)
  })

  it('修不了时返回错误而不是垃圾结果', () => {
    const r = repairJsonText('{"a": [1,2}')
    expect(r.ok).toBe(false)
  })
})

describe('api', () => {
  it('格式化 + 压缩', () => {
    const f = formatJsonText('{"a":[1,2]}', 2)
    expect(f.ok && f.output).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    const m = minifyJsonText('{ "a" : [ 1, 2 ] }')
    expect(m.ok && m.output).toBe('{"a":[1,2]}')
  })
  it('格式化失败返回中文错误', () => {
    const f = formatJsonText('{a:1}', 2)
    expect(f.ok).toBe(false)
    if (!f.ok) expect(f.error.message).toContain('属性名')
  })
})
