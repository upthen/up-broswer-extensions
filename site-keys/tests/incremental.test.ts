import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOC_PREFIX,
  LEGACY_NOTES_KEY,
  META_KEY,
  NOTE_PREFIX,
  WORKSPACE_KEY,
  MemoryStore,
  applyWrite,
  clearNotes,
  clearWorkspace,
  entryKey,
  loadWorkspace,
  metaFor,
  saveWorkspace,
} from '../src/core/storage'
import { createWorkspaceController } from '../src/ui/composables/useWorkspace'
import type { WorkspaceDeps } from '../src/ui/composables/useWorkspace'
import type { WorkspaceFile } from '../src/core/types'

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const note = { id: 'a', title: 'pyxis', content: '密码：x', createdAt: 1, updatedAt: 2 }
const doc = { id: 'd', title: '发布前检查', content: '一、环境信息', createdAt: 3, updatedAt: 4 }
const valid = (): WorkspaceFile => ({ version: 2, notes: [{ ...note }], docs: [{ ...doc }] })

class RecordingStore extends MemoryStore {
  writes: Record<string, unknown>[] = []
  removals: string[][] = []

  async setMany(items: Record<string, unknown>): Promise<void> {
    this.writes.push({ ...items })
    await super.setMany(items)
  }

  async removeMany(keys: string[]): Promise<void> {
    this.removals.push([...keys])
    await super.removeMany(keys)
  }
}

class FailingStore extends MemoryStore {
  failNext = false

  async setMany(items: Record<string, unknown>): Promise<void> {
    if (this.failNext) throw new Error('QUOTA_BYTES quota exceeded')
    await super.setMany(items)
  }
}

let seq = 0
const deps = (local: MemoryStore): WorkspaceDeps => ({
  local,
  now: () => 1000,
  seed: [{ title: 'A', content: '内容 A' }, { title: 'B', content: '内容 B' }],
  makeId: () => `id-${++seq}`,
})

describe('T-40 · v3 分键存储布局', () => {
  it('键名固定：meta + 两类条目前缀，v2 / v1 只作为迁移来源', () => {
    expect(META_KEY).toBe('sticky.workspace.v3')
    expect(NOTE_PREFIX).toBe('sticky.note.v3.')
    expect(DOC_PREFIX).toBe('sticky.doc.v3.')
    expect(WORKSPACE_KEY).toBe('sticky.workspace.v2')
    expect(LEGACY_NOTES_KEY).toBe('sticky.notes.v1')
  })

  it('saveWorkspace 拆成「一个索引 + 每条一个键」，不再写整库 v2 键', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    const all = await store.getAll()
    expect(all[WORKSPACE_KEY]).toBeUndefined()
    expect(all[META_KEY]).toEqual({ version: 3, notes: ['a'], docs: ['d'] })
    expect(all[NOTE_PREFIX + 'a']).toEqual(note)
    expect(all[DOC_PREFIX + 'd']).toEqual(doc)
    expect(await loadWorkspace(store)).toEqual(valid())
  })

  it('loadWorkspace 按 meta 的顺序组装，缺条目跳过且不抛异常', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, {
      version: 2,
      notes: [note, { ...note, id: 'b', title: '第二条' }],
      docs: [doc],
    })
    await store.remove(NOTE_PREFIX + 'b')
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes.map((n) => n.id)).toEqual(['a'])
    expect(loaded?.docs).toEqual([doc])
  })

  it('meta 存在但损坏时返回 null，不猜用户意图', async () => {
    const store = new MemoryStore()
    await store.set(META_KEY, { version: 9, notes: [], docs: [] })
    expect(await loadWorkspace(store)).toBeNull()
  })

  it('v2 整库平滑迁移：内容不丢、旧键删除、再加载稳定', async () => {
    const store = new MemoryStore()
    await store.set(WORKSPACE_KEY, valid())
    expect(await loadWorkspace(store)).toEqual(valid())
    expect(await store.get(WORKSPACE_KEY)).toBeUndefined()
    expect(await store.get(META_KEY)).toEqual({ version: 3, notes: ['a'], docs: ['d'] })
    expect(await store.get(NOTE_PREFIX + 'a')).toEqual(note)
    expect(await loadWorkspace(store)).toEqual(valid())
  })

  it('v1 旧库也直接迁到 v3，旧键删除', async () => {
    const store = new MemoryStore()
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    expect(await loadWorkspace(store)).toEqual({ version: 2, notes: [note], docs: [] })
    expect(await store.get(LEGACY_NOTES_KEY)).toBeUndefined()
    expect(await store.get(NOTE_PREFIX + 'a')).toEqual(note)
  })

  it('clearWorkspace 写空索引并删掉所有条目键，重启不会重新播种', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await clearWorkspace(store)
    expect(await store.get(META_KEY)).toEqual({ version: 3, notes: [], docs: [] })
    expect(await store.get(NOTE_PREFIX + 'a')).toBeUndefined()
    expect(await store.get(DOC_PREFIX + 'd')).toBeUndefined()
    expect(await loadWorkspace(store)).toEqual({ version: 2, notes: [], docs: [] })
  })

  it('clearNotes 只删便签条目键，文档与索引保留', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await clearNotes(store)
    expect(await store.get(NOTE_PREFIX + 'a')).toBeUndefined()
    expect(await store.get(DOC_PREFIX + 'd')).toEqual(doc)
    expect(await loadWorkspace(store)).toEqual({ version: 2, notes: [], docs: [doc] })
  })

  it('增量写入原语：entryKey / metaFor / applyWrite 只动指定键', async () => {
    const store = new MemoryStore()
    expect(entryKey('notes', 'a')).toBe(NOTE_PREFIX + 'a')
    expect(entryKey('docs', 'd')).toBe(DOC_PREFIX + 'd')
    expect(metaFor(valid())).toEqual({ version: 3, notes: ['a'], docs: ['d'] })
    await applyWrite(store, { [entryKey('notes', 'a')]: { ...note, title: '改了' } })
    const all = await store.getAll()
    expect(Object.keys(all)).toEqual([entryKey('notes', 'a')])
    expect(all[entryKey('notes', 'a')]).toMatchObject({ title: '改了' })
  })
})

describe('T-40 · 状态机只写改动的条目', () => {
  it('改一条便签：只写那一个条目键，不重写索引、不碰其它条目', async () => {
    const local = new RecordingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    const id = c.file!.notes[0]!.id
    local.writes.length = 0
    await c.updateNote(id, { title: '改名', content: '密码：new' })
    expect(local.writes).toHaveLength(1)
    expect(Object.keys(local.writes[0]!)).toEqual([NOTE_PREFIX + id])
    expect(local.writes[0]![NOTE_PREFIX + id]).toMatchObject({ title: '改名' })
  })

  it('改文档同样只写一条，重载后内容仍在', async () => {
    const local = new RecordingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    const id = await c.createDoc()
    local.writes.length = 0
    await c.updateDoc(id, { content: '很长很长的内容' })
    expect(Object.keys(local.writes[0]!)).toEqual([DOC_PREFIX + id])
    const reopened = createWorkspaceController(deps(local))
    await reopened.init()
    expect(reopened.file?.docs[0]!.content).toBe('很长很长的内容')
  })

  it('新建一次批量写：索引 + 新条目在同一批，保证不会留下孤儿或漏索引', async () => {
    const local = new RecordingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    local.writes.length = 0
    const id = await c.createNote()
    expect(local.writes).toHaveLength(1)
    expect(Object.keys(local.writes[0]!).sort()).toEqual(
      [META_KEY, NOTE_PREFIX + id].sort(),
    )
  })

  it('批量导入 3 篇文档只落盘一次', async () => {
    const local = new RecordingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    local.writes.length = 0
    await c.importDocs([
      { title: '一', content: '1' },
      { title: '二', content: '2' },
      { title: '三', content: '3' },
    ])
    expect(local.writes).toHaveLength(1)
    expect(Object.keys(local.writes[0]!).length).toBe(4) // meta + 3 篇
  })

  it('删除 / 清空会同步索引并移除对应条目键', async () => {
    const local = new RecordingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    const id = c.file!.notes[0]!.id
    local.removals.length = 0
    await c.removeNote(id)
    expect(local.removals.flat()).toContain(NOTE_PREFIX + id)
    local.removals.length = 0
    await c.clearNotes()
    expect(local.removals.flat().length).toBeGreaterThan(0)
    expect(await loadWorkspace(local)).toMatchObject({ notes: [] })
  })

  it('写入失败时抛错，内存镜像保持旧值，绝不假装已保存', async () => {
    const local = new FailingStore()
    const c = createWorkspaceController(deps(local))
    await c.init()
    const id = c.file!.notes[0]!.id
    const before = c.file!.notes[0]!.title
    local.failNext = true
    await expect(c.updateNote(id, { title: '不该生效' })).rejects.toThrow('QUOTA')
    expect(c.file!.notes[0]!.title).toBe(before)
    local.failNext = false
    await c.updateNote(id, { title: '重试成功' })
    expect(c.file!.notes[0]!.title).toBe('重试成功')
  })
})

describe('T-40 · UI 节流与未保存提示、配额权限', () => {
  it('App.vue 有 debounce、flush、页面隐藏时落盘、持久的未保存提示', () => {
    const app = read('src/ui/App.vue')
    expect(app).toContain('DEBOUNCE_MS')
    expect(app).toContain('flushWrites')
    expect(app).toContain('pagehide')
    expect(app).toContain('visibilitychange')
    expect(app).toContain('saveError')
    expect(app).toContain('writeFailure')
    expect(app).toContain('runAction')
    expect(app).toContain('pending')
    expect(app).not.toContain('>保存<')
  })

  it('manifest 增加 unlimitedStorage 解除 10 MB 上限，仍无其它权限', () => {
    const manifest = JSON.parse(read('public/manifest.json'))
    expect([...manifest.permissions].sort()).toEqual([
      'contextMenus', 'sidePanel', 'storage', 'unlimitedStorage',
    ])
    expect(manifest.host_permissions).toEqual([])
  })

  it('浏览器适配器补齐批量读写接口', () => {
    const src = read('src/platform/chromeStores.ts')
    expect(src).toContain('async getAll()')
    expect(src).toContain('async setMany(')
    expect(src).toContain('async removeMany(')
  })
})
