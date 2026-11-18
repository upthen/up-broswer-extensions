import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  META_KEY,
  NOTE_PREFIX,
  WORKSPACE_KEY,
  LEGACY_NOTES_KEY,
  MemoryStore,
  entryKey,
  loadWorkspace,
  saveWorkspace,
} from '../src/core/storage'
import { createWorkspaceController } from '../src/ui/composables/useWorkspace'
import type { WorkspaceDeps } from '../src/ui/composables/useWorkspace'
import type { WorkspaceFile } from '../src/core/types'
import {
  SELECTION_SIGNAL_KEY,
  createSelectionSaver,
  makeSelectionNote,
  normalizeSelection,
} from '../src/core/selection'
import type { SelectionSignal } from '../src/core/selection'

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const note = { id: 'a', title: 'pyxis', content: '密码：x', createdAt: 1, updatedAt: 2 }
const doc = { id: 'd', title: '发布前检查', content: '一、环境信息', createdAt: 3, updatedAt: 4 }
const valid = (): WorkspaceFile => ({ version: 2, notes: [{ ...note }], docs: [{ ...doc }] })

let seq = 0
const saverDeps = (store: MemoryStore, now = 2000) => ({
  store,
  now: () => now,
  makeId: () => `sel-${++seq}`,
})
const uiDeps = (store: MemoryStore): WorkspaceDeps => ({
  local: store,
  now: () => 1000,
  seed: [{ title: 'A', content: '内容 A' }, { title: 'B', content: '内容 B' }],
  makeId: () => `ui-${++seq}`,
})

class RecordingStore extends MemoryStore {
  writes: Record<string, unknown>[] = []
  async setMany(items: Record<string, unknown>): Promise<void> {
    this.writes.push({ ...items })
    await super.setMany(items)
  }
}

class FailingStore extends MemoryStore {
  fail = false
  async setMany(items: Record<string, unknown>): Promise<void> {
    if (this.fail) throw new Error('QUOTA_BYTES quota exceeded')
    await super.setMany(items)
  }
}

/** 让「读索引 → 写索引」之间真的存在交错窗口，验证串行队列不是摆设。 */
class SlowStore extends MemoryStore {
  private tick = () => new Promise<void>((r) => setTimeout(r, 5))
  async getAll(): Promise<Record<string, unknown>> { await this.tick(); return super.getAll() }
  async setMany(items: Record<string, unknown>): Promise<void> { await this.tick(); await super.setMany(items) }
}

describe('T-41 · 选中文本的归一化与便签生成', () => {
  it('只去掉首尾空白，正文内部缩进与换行原样保留', () => {
    expect(normalizeSelection('  \n  第一行\n    第二行  \n\n')).toBe('第一行\n    第二行')
    expect(normalizeSelection('单行长文本')).toBe('单行长文本')
  })

  it('空串 / 纯空白 / undefined 一律返回 null，不建空便签', () => {
    expect(normalizeSelection('')).toBeNull()
    expect(normalizeSelection('   \n\t \r\n ')).toBeNull()
    expect(normalizeSelection(undefined as unknown as string)).toBeNull()
    expect(makeSelectionNote('   ', 'x', 1)).toBeNull()
  })

  it('标题取首个非空行前 24 字，正文完整、时间戳一致', () => {
    const text = '\n\n  部署环境地址：http://10.0.0.1:8080  \n  账号 admin / 密码 123456\n'
    const entry = makeSelectionNote(text, 'id-1', 999)!
    expect(entry).toMatchObject({ id: 'id-1', createdAt: 999, updatedAt: 999 })
    expect(entry.content).toBe('部署环境地址：http://10.0.0.1:8080  \n  账号 admin / 密码 123456')
    expect(entry.title).toBe('部署环境地址：http://10.0.0.1:8080'.slice(0, 24))
    expect(entry.title).toHaveLength(24)
  })

  it('超长首行标题截断到 24 字，正文一个字不少', () => {
    const long = '甲'.repeat(80)
    const entry = makeSelectionNote(long, 'id-2', 1)!
    expect(entry.title).toHaveLength(24)
    expect(entry.content).toBe(long)
  })

  it('多行文本的 CRLF 与空行都保留，不改写用户选中的内容', () => {
    const text = '甲\r\n\r\n乙\n丙'
    expect(makeSelectionNote(text, 'id-3', 1)!.content).toBe(text)
  })
})

describe('T-41 · 后台落库：迁移前置、原子写入、串行队列', () => {
  it('空库首次右键：建立索引 + 新便签 + 成功信号，界面能读回', async () => {
    const store = new RecordingStore()
    const entry = await createSelectionSaver(saverDeps(store)).save('  选中内容  ')
    expect(entry?.content).toBe('选中内容')
    expect(store.writes).toHaveLength(1)
    expect(Object.keys(store.writes[0]!).sort()).toEqual(
      [META_KEY, entryKey('notes', entry!.id), SELECTION_SIGNAL_KEY].sort(),
    )
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes.map((n) => n.content)).toEqual(['选中内容'])
    expect(await store.get(SELECTION_SIGNAL_KEY)).toMatchObject({ ok: true, id: entry!.id })
  })

  it('已有 v2 整库：先迁移再追加，旧便签与文档一条不丢、旧键删除', async () => {
    const store = new MemoryStore()
    await store.set(WORKSPACE_KEY, valid())
    const entry = await createSelectionSaver(saverDeps(store)).save('新存的一段')
    expect(entry).not.toBeNull()
    expect(await store.get(WORKSPACE_KEY)).toBeUndefined()
    const loaded = await loadWorkspace(store)
    expect(loaded?.notes.map((n) => n.content)).toEqual(['新存的一段', '密码：x'])
    expect(loaded?.docs).toEqual([doc])
  })

  it('已有 v1 旧库：同样先迁移再追加', async () => {
    const store = new MemoryStore()
    await store.set(LEGACY_NOTES_KEY, { version: 1, notes: [note] })
    await createSelectionSaver(saverDeps(store)).save('来自网页')
    expect(await store.get(LEGACY_NOTES_KEY)).toBeUndefined()
    expect((await loadWorkspace(store))?.notes.map((n) => n.content)).toEqual(['来自网页', '密码：x'])
  })

  it('已有 v3 分键数据：追加到便签最前，docs 顺序与内容完全不变', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await createSelectionSaver(saverDeps(store)).save('新增')
    const all = await store.getAll()
    expect(all[META_KEY]).toEqual({ version: 3, notes: [expect.any(String), 'a'], docs: ['d'] })
    expect(all[entryKey('notes', 'a')]).toEqual(note)
    expect(all[entryKey('docs', 'd')]).toEqual(doc)
  })

  it('连续两次保存顺序稳定：后存的排在最前', async () => {
    const store = new MemoryStore()
    const saver = createSelectionSaver(saverDeps(store))
    await saver.save('第一段')
    await saver.save('第二段')
    expect((await loadWorkspace(store))?.notes.map((n) => n.content)).toEqual(['第二段', '第一段'])
  })

  it('并发两次右键不丢数据（读索引与写索引被串行化）', async () => {
    const store = new SlowStore()
    const saver = createSelectionSaver(saverDeps(store))
    await Promise.all([saver.save('并发一'), saver.save('并发二')])
    expect((await loadWorkspace(store))?.notes.map((n) => n.content).sort()).toEqual(['并发一', '并发二'])
  })

  it('空白选中不写盘、不留信号', async () => {
    const store = new RecordingStore()
    expect(await createSelectionSaver(saverDeps(store)).save('  \n  ')).toBeNull()
    expect(store.writes).toHaveLength(0)
    expect(await store.get(SELECTION_SIGNAL_KEY)).toBeUndefined()
  })

  it('写盘失败：抛错、不留半截条目、写失败信号通知界面', async () => {
    const store = new FailingStore()
    await saveWorkspace(store, valid())
    store.fail = true
    const saver = createSelectionSaver(saverDeps(store))
    await expect(saver.save('存不进去')).rejects.toThrow('QUOTA')
    expect((await loadWorkspace(store))?.notes.map((n) => n.id)).toEqual(['a'])
    const signal = await store.get(SELECTION_SIGNAL_KEY) as SelectionSignal
    expect(signal.ok).toBe(false)
    expect(signal.reason).toContain('QUOTA')
  })

  it('失败后队列不被卡死，下一次保存仍成功', async () => {
    const store = new FailingStore()
    store.fail = true
    const saver = createSelectionSaver(saverDeps(store))
    await expect(saver.save('第一次')).rejects.toThrow('QUOTA')
    store.fail = false
    expect(await saver.save('第二次')).not.toBeNull()
    expect((await loadWorkspace(store))?.notes.map((n) => n.content)).toEqual(['第二次'])
  })

  it('界面 reload() 后立刻看到后台新存的便签，且排在最前', async () => {
    const store = new MemoryStore()
    const controller = createWorkspaceController(uiDeps(store))
    await controller.init()
    expect(controller.file?.notes).toHaveLength(2)
    await createSelectionSaver(saverDeps(store)).save('网页上选的')
    expect(controller.file?.notes).toHaveLength(2) // 内存镜像尚未感知外部写入
    await controller.reload()
    expect(controller.file?.notes).toHaveLength(3)
    expect(controller.file?.notes[0]?.content).toBe('网页上选的')
  })
})

describe('T-41 · 最小权限与零注入守卫', () => {
  it('manifest 只多一个 contextMenus，host_permissions 仍为空', () => {
    const manifest = JSON.parse(read('public/manifest.json'))
    expect([...manifest.permissions].sort()).toEqual([
      'contextMenus', 'sidePanel', 'storage', 'unlimitedStorage',
    ])
    expect(manifest.host_permissions).toEqual([])
    for (const p of ['activeTab', 'tabs', 'scripting', 'clipboardRead', 'downloads', 'history']) {
      expect(manifest.permissions).not.toContain(p)
    }
    expect(manifest.content_scripts).toBeUndefined()
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>')
  })

  it('后台在 onInstalled 里幂等注册 selection 菜单，用 onClicked 取 selectionText', () => {
    const src = read('src/background/index.ts')
    expect(src).toContain('contextMenus.removeAll')
    expect(src).toMatch(/contextMenus\.create\(\{[\s\S]*?contexts:\s*\['selection'\]/)
    expect(src).toContain('contextMenus.onClicked')
    expect(src).toContain('info.selectionText')
    expect(src).toContain("title: '存为便签'")
    expect(src).toMatch(/onInstalled\.addListener\([\s\S]*?contextMenus\.create/)
    // 顶层不重复 create：整个文件只创建一次
    expect(src.match(/contextMenus\.create\(/g)).toHaveLength(1)
    for (const word of ['chrome.scripting', 'executeScript', 'activeTab', 'clipboardRead']) {
      expect(src).not.toContain(word)
    }
  })

  it('界面只监听一个信号键，刷新前先 flush，不引入全量读盘', () => {
    const app = read('src/ui/App.vue')
    expect(app).toContain('SELECTION_SIGNAL_KEY')
    expect(app).toContain('storage.onChanged')
    expect(app).toContain('controller.reload()')
    expect(app).toContain('flushWrites()')
    expect(app).toContain('已存为便签')
    expect(read('src/ui/composables/useWorkspace.ts')).toContain('async reload()')
  })

  it('信号键不属于条目或索引，不会被 loadWorkspace 当成数据', async () => {
    const store = new MemoryStore()
    await saveWorkspace(store, valid())
    await store.set(SELECTION_SIGNAL_KEY, { ok: true, id: 'x', at: 1 })
    expect(await loadWorkspace(store)).toEqual(valid())
    expect(SELECTION_SIGNAL_KEY).not.toBe(META_KEY)
    expect(SELECTION_SIGNAL_KEY.startsWith(NOTE_PREFIX)).toBe(false)
  })
})
