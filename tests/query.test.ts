import { describe, expect, it } from 'vitest'
import { queryJsonPath, JSONPATH_PRESETS } from '../src/core/query/jsonpath'
import type { JsonValue } from '../src/core/json/value'

const doc: JsonValue = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings', price: 8.95, isbn: 'A1' },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword', price: 12.99 },
      { category: 'fiction', author: 'J. R. R.', title: 'Ring', price: 22.5, tags: ['a', 'b'] },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
  tags: ['json', 'dev'],
  count: 3,
  enabled: true,
  nothing: null,
}

function paths(expr: string): string[] {
  const r = queryJsonPath(doc, expr)
  if (!r.ok) throw new Error(`${expr} → ${r.message}`)
  return r.matches.map((m) => m.path)
}

function values(expr: string): JsonValue[] {
  const r = queryJsonPath(doc, expr)
  if (!r.ok) throw new Error(`${expr} → ${r.message}`)
  return r.matches.map((m) => m.value)
}

describe('JSONPath 基础选择', () => {
  it('根节点与单级属性', () => {
    expect(paths('$')).toEqual(['$'])
    expect(paths('$.store')).toEqual(["$['store']"])
    expect(values('$.count')).toEqual([3])
  })

  it('点号与引号两种写法等价', () => {
    expect(paths("$.store['bicycle']['color']")).toEqual(paths('$.store.bicycle.color'))
    expect(values('$.store.bicycle.color')).toEqual(['red'])
  })

  it('通配符同时覆盖对象与数组', () => {
    expect(paths('$.store.book[*].title')).toHaveLength(3)
    expect(paths('$.store.*')).toHaveLength(2)
  })

  it('数组下标、负下标、联合、切片', () => {
    expect(values('$.tags[0]')).toEqual(['json'])
    expect(values('$.tags[-1]')).toEqual(['dev'])
    expect(values('$.tags[0,1]')).toEqual(['json', 'dev'])
    expect(values('$.store.book[0:2].title')).toEqual(['Sayings', 'Sword'])
    expect(values('$.store.book[::2].title')).toEqual(['Sayings', 'Ring'])
    expect(values('$.store.book[1:].title')).toEqual(['Sword', 'Ring'])
  })

  it('越界下标不报异常', () => {
    expect(paths('$.tags[9]')).toEqual([])
    expect(values('$.tags[-9]')).toEqual([])
  })

  it('递归下降', () => {
    expect(values('$..author')).toEqual(['Nigel Rees', 'Evelyn Waugh', 'J. R. R.'])
    expect(paths('$..price')).toHaveLength(4)
    expect(paths('$..*').length).toBeGreaterThan(15)
    expect(paths('$..*').every((p) => p !== '$')).toBe(true)
  })

  it('递归 + 中括号选择器', () => {
    expect(values('$..[0]').length).toBeGreaterThan(0)
    expect(paths("$..['title']")).toHaveLength(3)
  })

  it('路径一律规范化输出', () => {
    expect(paths('$["store"]["book"][0]["title"]')[0]).toBe("$['store']['book'][0]['title']")
  })
})

describe('JSONPath 过滤表达式', () => {
  it('数值比较与逻辑运算', () => {
    expect(values('$.store.book[?(@.price < 10)].title')).toEqual(['Sayings'])
    expect(values('$.store.book[?(@.price >= 20)].title')).toEqual(['Ring'])
    expect(values("$.store.book[?(@.price > 10 && @.category == 'fiction')].title")).toEqual(['Sword', 'Ring'])
    expect(values("$.store.book[?(@.category == 'reference' || @.price > 20)].title")).toEqual(['Sayings', 'Ring'])
  })

  it('存在性判断与取反', () => {
    expect(values('$.store.book[?(@.isbn)].title')).toEqual(['Sayings'])
    expect(values('$.store.book[?(!@.isbn)].title')).toEqual(['Sword', 'Ring'])
  })

  it('@ 数组/字面量/正则', () => {
    expect(values("$.store.book[?(@.tags[0] == 'a')].title")).toEqual(['Ring'])
    expect(values('$..[?(@ == true)]')).toEqual([true])
    expect(values('$.store.book[?(@.author =~ /^E/)].title')).toEqual(['Sword'])
    expect(values("$.store.book[?(@.author =~ 'J\\.')].title")).toEqual(['Ring'])
  })

  it('括号分组', () => {
    expect(values("$.store.book[?((@.price < 10 || @.price > 20) && @.category != 'x')].title")).toEqual([
      'Sayings',
      'Ring',
    ])
  })

  it('不存在的字段不会误匹配', () => {
    expect(paths('$.store.book[?(@.missing > 1)]')).toEqual([])
  })
})

describe('JSONPath 错误与健壮性', () => {
  it('表达式必须 $ 开头', () => {
    const r = queryJsonPath(doc, 'store.book')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('$')
  })

  it('非法字符、括号不闭合、过滤表达式残缺都给中文错误', () => {
    for (const expr of ['$.a b', '$["abc', '$.a.', '$[?(]', '$.a[?(@.x < )]', '$[1:2:3:4]']) {
      const r = queryJsonPath(doc, expr)
      expect(r.ok, expr).toBe(false)
      if (!r.ok) expect(typeof r.index).toBe('number')
    }
  })

  it('空表达式与空结果', () => {
    const empty = queryJsonPath(doc, '   ')
    expect(empty.ok).toBe(false)
    expect(queryJsonPath(null, '$.a')).toEqual({ ok: true, matches: [], count: 0, truncated: false })
  })

  it('预设表达式都能正常运行', () => {
    for (const preset of JSONPATH_PRESETS) {
      const r = queryJsonPath(doc, preset.expression)
      expect(r.ok, preset.expression).toBe(true)
    }
  })
})
