import { describe, expect, it } from 'vitest'
import {
  addEntry,
  countChars,
  createEmptyWorkspace,
  deleteEntry,
  excerpt,
  extractPassword,
  normalizeTitle,
  searchEntries,
  sortByUpdated,
  updateEntry,
} from '../src/core/workspace'
import type { WorkspaceFile } from '../src/core/types'

const fileWith = (...titles: string[]): WorkspaceFile => ({
  version: 2,
  notes: titles.map((title, i) => ({
    id: `n${i}`,
    title,
    content: `正文 ${title}`,
    createdAt: 100 + i,
    updatedAt: 100 + i,
  })),
  docs: [],
})

describe('T-32 · 双模块数据模型与统一条目操作', () => {
  it('createEmptyWorkspace 是 v2 空库，两类列表都存在', () => {
    expect(createEmptyWorkspace()).toEqual({ version: 2, notes: [], docs: [] })
  })

  it('normalizeTitle 三级兜底，且 fallback 可自定义（便签 / 文档不同）', () => {
    expect(normalizeTitle('  pyxis  ', '正文')).toBe('pyxis')
    expect(normalizeTitle('', '第一行\n第二行')).toBe('第一行')
    expect(normalizeTitle('', '   \n第二行\n第三行')).toBe('第二行')
    expect(normalizeTitle('', 'a'.repeat(50)).length).toBe(24)
    expect(normalizeTitle('', '  \n  ')).toBe('未命名便签')
    expect(normalizeTitle('', '', '未命名文档')).toBe('未命名文档')
  })

  it('addEntry 只动指定 kind，插到最前、写时间戳、不改原库', () => {
    const before = createEmptyWorkspace()
    const after = addEntry(before, 'notes', { title: 'A', content: '内容' }, 'id-1', 500)
    expect(before.notes).toHaveLength(0)
    expect(after.notes[0]).toEqual({
      id: 'id-1', title: 'A', content: '内容', createdAt: 500, updatedAt: 500,
    })
    expect(after.docs).toEqual([])

    const second = addEntry(after, 'notes', { title: '', content: '第二行内容' }, 'id-2', 600)
    expect(second.notes.map((n) => n.id)).toEqual(['id-2', 'id-1'])
    expect(second.notes[0]!.title).toBe('第二行内容')
  })

  it('addEntry(docs) 不碰 notes，标题用「未命名文档」兜底', () => {
    const withNote = addEntry(createEmptyWorkspace(), 'notes', { title: 'A', content: 'x' }, 'n1', 1)
    const withDoc = addEntry(withNote, 'docs', { title: '', content: '' }, 'd1', 2)
    expect(withDoc.notes).toEqual(withNote.notes)
    expect(withDoc.docs[0]!.title).toBe('未命名文档')
    expect(withDoc.docs[0]!.id).toBe('d1')
  })

  it('updateEntry 保留 id/createdAt，只改传入字段与 updatedAt；找不到返回原对象', () => {
    const file = addEntry(createEmptyWorkspace(), 'notes', { title: 'A', content: '旧' }, 'id-1', 500)
    const next = updateEntry(file, 'notes', 'id-1', { title: 'B', content: '新' }, 900)
    expect(next.notes[0]).toEqual({
      id: 'id-1', title: 'B', content: '新', createdAt: 500, updatedAt: 900,
    })
    expect(file.notes[0]!.title).toBe('A')
    expect(updateEntry(file, 'notes', '不存在', { title: 'X' }, 900)).toBe(file)
  })

  it('updateEntry(docs) 不触碰便签列表', () => {
    const file = addEntry(
      addEntry(createEmptyWorkspace(), 'notes', { title: 'N', content: 'n' }, 'n1', 1),
      'docs', { title: 'D', content: 'd' }, 'd1', 2,
    )
    const next = updateEntry(file, 'docs', 'd1', { content: '改写' }, 9)
    expect(next.docs[0]!.content).toBe('改写')
    expect(next.notes).toBe(file.notes)
  })

  it('deleteEntry 按 id 删除，不改原库、不跨 kind', () => {
    const file = {
      ...fileWith('A', 'B', 'C'),
      docs: [{ id: 'd0', title: '文档', content: 'x', createdAt: 1, updatedAt: 1 }],
    }
    const next = deleteEntry(file, 'notes', 'n1')
    expect(next.notes.map((n) => n.id)).toEqual(['n0', 'n2'])
    expect(next.docs).toEqual(file.docs)
    expect(file.notes).toHaveLength(3)
  })

  it('searchEntries：标题+正文、多词 AND、大小写不敏感、空 query 返回全部且保留原引用', () => {
    const entries = [
      { id: '1', title: 'pyxis', content: 'https://10.6.125.231:30443 admin', createdAt: 1, updatedAt: 1 },
      { id: '2', title: 'Monitor', content: 'grafana 账号 ADMIN', createdAt: 2, updatedAt: 2 },
    ]
    expect(searchEntries(entries, 'admin').map((n) => n.id)).toEqual(['1', '2'])
    expect(searchEntries(entries, 'ADMIN grafana').map((n) => n.id)).toEqual(['2'])
    expect(searchEntries(entries, '10.6.125.231').map((n) => n.id)).toEqual(['1'])
    expect(searchEntries(entries, '不存在的词')).toEqual([])
    expect(searchEntries(entries, '  ')[0]).toBe(entries[0])
  })

  it('sortByUpdated 降序，同值按 createdAt 降序，不修改入参', () => {
    const notes = fileWith('A', 'B', 'C').notes.map((n, i) => ({
      ...n, createdAt: i, updatedAt: 50,
    }))
    notes[0]!.updatedAt = 10
    const sorted = sortByUpdated(notes)
    expect(sorted.map((n) => n.id)).toEqual(['n2', 'n1', 'n0'])
    expect(notes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])
  })
})

describe('T-32 · 卡片摘要与字数', () => {
  it('excerpt 跳过空行、只取前 N 行、超长截断，且不改原文', () => {
    const source = '  \n第一行\n第二行\n第三行\n第四行'
    expect(excerpt(source, 2)).toBe('第一行\n第二行')
    expect(excerpt('a'.repeat(200), 1)).toBe('a'.repeat(80))
    expect(excerpt('  \n  ', 4)).toBe('')
    expect(source).toContain('第四行')
  })

  it('countChars 去掉空白后再计数', () => {
    expect(countChars('a b\n c')).toBe(3)
    expect(countChars('地址：http://x')).toBe('地址：http://x'.length)
    expect(countChars('')).toBe(0)
  })
})

describe('T-32 · 密码行轻量识别（沿用 v3，不强制格式）', () => {
  it('中文冒号 / 英文冒号 / 空格都能取到', () => {
    expect(extractPassword('密码：abc123')).toBe('abc123')
    expect(extractPassword('密 码： Poc@Meta_027n ')).toBe('Poc@Meta_027n')
    expect(extractPassword('password: abc 123')).toBe('abc 123')
    expect(extractPassword('  PassWD ：x/y+z  ')).toBe('x/y+z')
  })

  it('多行时取最后一个匹配', () => {
    expect(extractPassword('地址：http://x\n密码：first\n备注：无\n密码：last')).toBe('last')
  })

  it('不匹配的行返回 null，不误取', () => {
    expect(extractPassword('随便一段文字')).toBeNull()
    expect(extractPassword('这是密码说明：没有匹配前缀')).toBeNull()
    expect(extractPassword('密码：')).toBeNull()
    expect(extractPassword('')).toBeNull()
  })
})
