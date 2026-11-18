import { describe, expect, it } from 'vitest'
import {
  DOC_PREFIX,
  LEGACY_NOTES_KEY,
  META_KEY,
  NOTE_PREFIX,
  WORKSPACE_KEY,
  MemoryStore,
  clearNotes,
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
} from '../src/core/storage'
import { createEmptyWorkspace } from '../src/core/workspace'

const note = { id: 'a', title: 'pyxis', content: '密码：x', createdAt: 1, updatedAt: 2 }
const doc = { id: 'd', title: '发布前检查', content: '一、环境信息', createdAt: 3, updatedAt: 4 }
const valid = () => ({ version: 2 as const, notes: [note], docs: [doc] })
const meta = { version: 3, notes: ['a'], docs: ['d'] }

describe('T-31/T-40 · 存储键与读写（v3 分键布局）', () => {
  it('键名固定：v3 索引 + 两类条目前缀，v2 / v1 只作迁移来源', () => {
    expect(META_KEY).toBe('sticky.workspace.v3')
    expect(NOTE_PREFIX).toBe('sticky.note.v3.')
    expect(DOC_PREFIX).toBe('sticky.doc.v3.')
    expect(WORKSPACE_KEY).toBe('sticky.workspace.v2')
    expect(LEGACY_NOTES_KEY).toBe('sticky.notes.v1')
  })

  it('saveWorkspace / loadWorkspace 往返一致（两类列表都在）', async () => {
    const store = new MemoryStore()
    const file = valid()
    await saveWorkspace(store, file)
    expect(await loadWorkspace(store)).toEqual(file)
  })

  it('clearWorkspace 保留空索引键（防止下次启动重新播种）', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await clearWorkspace(store)
    expect(await store.get(META_KEY)).toEqual({ version: 3, notes: [], docs: [] })
    expect(await loadWorkspace(store)).toEqual(createEmptyWorkspace())
  })

  it('clearNotes 只清便签，保留文档', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await clearNotes(store)
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes).toEqual([])
    expect(loaded?.docs).toEqual([doc])
  })

  it('键不存在 / 数据为 null 时返回 null', async () => {
    expect(await loadWorkspace(new MemoryStore())).toBeNull()
    const store = new MemoryStore()
    await store.set(META_KEY, null)
    expect(await loadWorkspace(store)).toBeNull()
  })
})

describe('T-31/T-40 · 坏数据一律当作「无库」，不抛异常', () => {
  const cases: [string, unknown][] = [
    ['版本号不符', { version: 1, notes: [], docs: [] }],
    ['缺 docs', { version: 3, notes: [] }],
    ['缺 notes', { version: 3, docs: [] }],
    ['notes 不是数组', { version: 3, notes: 'oops', docs: [] }],
    ['docs 不是数组', { version: 3, notes: [], docs: 'oops' }],
    ['notes 含 null 元素', { version: 3, notes: [null], docs: [] }],
    ['notes id 类型错误', { version: 3, notes: [1], docs: [] }],
    ['顶层是数组', []],
    ['顶层是字符串', 'junk'],
  ]
  for (const [name, value] of cases) {
    it(name, async () => {
      const store = new MemoryStore()
      await store.set(META_KEY, value)
      expect(await loadWorkspace(store)).toBeNull()
    })
  }

  it('条目本身缺字段 / 类型错误时跳过该条，不影响其它条目', async () => {
    const store = new MemoryStore()
    await store.set(META_KEY, { version: 3, notes: ['a', 'bad'], docs: ['d'] })
    await store.set(NOTE_PREFIX + 'a', note)
    await store.set(NOTE_PREFIX + 'bad', { id: 'bad', title: 1, content: 'y' })
    await store.set(DOC_PREFIX + 'd', doc)
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes).toEqual([note])
    expect(loaded?.docs).toEqual([doc])
  })

  it('时间戳缺失时补 0，不影响读入', async () => {
    const store = new MemoryStore()
    await store.set(META_KEY, meta)
    await store.set(NOTE_PREFIX + 'a', { id: 'a', title: 'x', content: 'y' })
    await store.set(DOC_PREFIX + 'd', { id: 'd', title: 'z', content: 'w' })
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes[0]).toMatchObject({ createdAt: 0, updatedAt: 0 })
    expect(loaded?.docs[0]).toMatchObject({ createdAt: 0, updatedAt: 0 })
  })

  it('v2 整库是坏数据时不迁移，返回 null', async () => {
    const store = new MemoryStore()
    await store.set(WORKSPACE_KEY, { version: 2, notes: 'broken' })
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    expect(await loadWorkspace(store)).toBeNull()
    expect(await store.get(LEGACY_NOTES_KEY)).toEqual({ version: 1, notes: [note] })
  })
})

describe('T-31/T-40 · v1 / v2 → v3 平滑迁移（用户已录入的数据不能丢）', () => {
  it('只存在 v1 旧键时：转成 v3 分键、docs 为空、删除旧键', async () => {
    const store = new MemoryStore()
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    const loaded = await loadWorkspace(store)
    expect(loaded).toEqual({ version: 2, notes: [note], docs: [] })
    expect(await store.get(META_KEY)).toEqual({ version: 3, notes: ['a'], docs: [] })
    expect(await store.get(NOTE_PREFIX + 'a')).toEqual(note)
    expect(await store.get(LEGACY_NOTES_KEY)).toBeUndefined()
  })

  it('只存在 v2 整库时：拆成分键、内容不丢、删除整库键', async () => {
    const store = new MemoryStore()
    await store.set(WORKSPACE_KEY, valid())
    expect(await loadWorkspace(store)).toEqual(valid())
    expect(await store.get(META_KEY)).toEqual(meta)
    expect(await store.get(NOTE_PREFIX + 'a')).toEqual(note)
    expect(await store.get(DOC_PREFIX + 'd')).toEqual(doc)
    expect(await store.get(WORKSPACE_KEY)).toBeUndefined()
  })

  it('迁移后再加载不重复迁移、数据稳定', async () => {
    const store = new MemoryStore()
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    const first = await loadWorkspace(store)
    const second = await loadWorkspace(store)
    expect(second).toEqual(first)
    expect(await store.get(LEGACY_NOTES_KEY)).toBeUndefined()
  })

  it('v3 索引已存在时以 v3 为准，旧键原样不动', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await store.set(WORKSPACE_KEY, { version: 2, notes: [], docs: [] })
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    expect(await loadWorkspace(store)).toEqual(valid())
    expect(await store.get(WORKSPACE_KEY)).toEqual({ version: 2, notes: [], docs: [] })
    expect(await store.get(LEGACY_NOTES_KEY)).toEqual({ version: 1, notes: [note] })
  })

  it('旧键本身是坏数据时返回 null，不迁移', async () => {
    const store = new MemoryStore()
    await store.set(LEGACY_NOTES_KEY, { version: 9, notes: [] })
    expect(await loadWorkspace(store)).toBeNull()
  })
})
