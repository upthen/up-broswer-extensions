import {
  addEntry,
  createEmptyWorkspace,
  deleteEntry,
  extractPassword,
  sortByUpdated,
  updateEntry,
} from '../../core/workspace'
import {
  META_KEY,
  MemoryStore,
  applyWrite,
  entryKey,
  loadWorkspace,
  metaFor,
  saveWorkspace,
} from '../../core/storage'
import type { KeyValueStore } from '../../core/storage'
import type { EntryPatch, ModuleId, SeedNote, WorkspaceFile } from '../../core/types'
import type { ImportEntry } from '../../core/textFile'
import { ChromeLocalStore } from '../../platform/chromeStores'
import { INITIAL_NOTES } from '../../seed/initialNotes'

/** SPEC v4.0 §6：只有加载中与可用两种状态，打开即用、输入即存。 */
export type WorkspaceState = 'loading' | 'ready'

export interface WorkspaceDeps {
  local: KeyValueStore
  now: () => number
  seed: SeedNote[]
  makeId: () => string
}

export interface WorkspaceController {
  readonly state: WorkspaceState
  readonly file: WorkspaceFile | null
  readonly activeModule: ModuleId
  readonly activeDocId: string | null
  init(): Promise<void>
  /** 外部上下文写入后重读磁盘；调用方需先 flush 未落盘的输入 */
  reload(): Promise<void>
  setModule(id: ModuleId): void
  setActiveDoc(id: string | null): void
  createNote(): Promise<string>
  updateNote(id: string, patch: EntryPatch): Promise<void>
  removeNote(id: string): Promise<void>
  clearNotes(): Promise<void>
  createDoc(): Promise<string>
  importDocs(inputs: ImportEntry[]): Promise<string[]>
  updateDoc(id: string, patch: EntryPatch): Promise<void>
  removeDoc(id: string): Promise<void>
  readPassword(id: string): string | null
}

const defaultDeps = (): WorkspaceDeps => ({
  // 扩展页面始终写 chrome.storage.local；普通网页预览（vite dev）退化为内存，
  // 让界面能直接打开，且不写入任何真实数据。
  local: typeof chrome !== 'undefined' && !!chrome.storage?.local
    ? new ChromeLocalStore()
    : new MemoryStore(),
  now: () => Date.now(),
  seed: INITIAL_NOTES,
  makeId: () => crypto.randomUUID(),
})

/** 纯 TypeScript 状态机；浏览器能力由依赖注入，便于 TDD。 */
export function createWorkspaceController(overrides: Partial<WorkspaceDeps> = {}): WorkspaceController {
  const deps: WorkspaceDeps = { ...defaultDeps(), ...overrides }
  let state: WorkspaceState = 'loading'
  let current: WorkspaceFile | null = null
  let module: ModuleId = 'stickies'
  let activeDoc: string | null = null

  const requireFile = (): WorkspaceFile => {
    if (!current) throw new Error('数据尚未初始化')
    return current
  }

  /**
   * 增量落盘：只写本次改动的条目键（必要时加一份很小的 id 索引）。
   * 写盘成功后才更新内存镜像；写失败就抛给调用方，绝不假装已保存。
   */
  const commit = async (
    next: WorkspaceFile,
    items: Record<string, unknown>,
    removeKeys: string[] = [],
  ): Promise<void> => {
    await applyWrite(deps.local, items, removeKeys)
    current = next
    state = 'ready'
  }

  return {
    get state() { return state },
    get file() { return current },
    get activeModule() { return module },
    get activeDocId() { return activeDoc },

    async init() {
      const loaded = await loadWorkspace(deps.local)
      if (loaded) {
        current = {
          ...loaded,
          notes: sortByUpdated(loaded.notes),
          docs: sortByUpdated(loaded.docs),
        }
        state = 'ready'
      } else {
        // 仅全新安装时播种一次；删光 / 清空后索引键仍在，不会补回
        const seeded = [...deps.seed]
          .reverse()
          .reduce(
            (file, note) => addEntry(file, 'notes', note, deps.makeId(), deps.now()),
            createEmptyWorkspace(),
          )
        await saveWorkspace(deps.local, seeded)
        current = seeded
        state = 'ready'
      }
      activeDoc = current?.docs[0]?.id ?? null
    },

    /** 只读不写：后台右键保存后，界面据此刷新列表，不重置当前模块。 */
    async reload() {
      const loaded = await loadWorkspace(deps.local)
      if (!loaded) return
      current = {
        ...loaded,
        notes: sortByUpdated(loaded.notes),
        docs: sortByUpdated(loaded.docs),
      }
      if (!current.docs.some((doc) => doc.id === activeDoc)) {
        activeDoc = current.docs[0]?.id ?? null
      }
      state = 'ready'
    },

    setModule(id) { module = id },
    setActiveDoc(id) { activeDoc = id },

    async createNote() {
      const id = deps.makeId()
      const next = addEntry(requireFile(), 'notes', { title: '', content: '' }, id, deps.now())
      const created = next.notes.find((entry) => entry.id === id)
      if (!created) throw new Error('新建便签失败')
      await commit(next, { [META_KEY]: metaFor(next), [entryKey('notes', id)]: created })
      return id
    },

    async updateNote(id, patch) {
      const next = updateEntry(requireFile(), 'notes', id, patch, deps.now())
      const updated = next.notes.find((entry) => entry.id === id)
      if (!updated) return
      await commit(next, { [entryKey('notes', id)]: updated })
    },

    async removeNote(id) {
      const next = deleteEntry(requireFile(), 'notes', id)
      await commit(next, { [META_KEY]: metaFor(next) }, [entryKey('notes', id)])
    },

    async clearNotes() {
      const before = requireFile()
      const next = { ...before, notes: [] }
      await commit(
        next,
        { [META_KEY]: metaFor(next) },
        before.notes.map((entry) => entryKey('notes', entry.id)),
      )
    },

    async createDoc() {
      const id = deps.makeId()
      const next = addEntry(requireFile(), 'docs', { title: '', content: '' }, id, deps.now())
      const created = next.docs.find((entry) => entry.id === id)
      if (!created) throw new Error('新建文档失败')
      await commit(next, { [META_KEY]: metaFor(next), [entryKey('docs', id)]: created })
      activeDoc = id
      return id
    },

    /** 批量导入：整批只写一次盘，meta 与所有新文档在同一批里。 */
    async importDocs(inputs) {
      if (inputs.length === 0) return []
      const ids = inputs.map(() => deps.makeId())
      const now = deps.now()
      let file = requireFile()
      for (let i = inputs.length - 1; i >= 0; i--) {
        file = addEntry(file, 'docs', inputs[i]!, ids[i]!, now)
      }
      const items: Record<string, unknown> = { [META_KEY]: metaFor(file) }
      for (const id of ids) {
        const created = file.docs.find((entry) => entry.id === id)
        if (created) items[entryKey('docs', id)] = created
      }
      await commit(file, items)
      activeDoc = ids[0]!
      return ids
    },

    async updateDoc(id, patch) {
      const next = updateEntry(requireFile(), 'docs', id, patch, deps.now())
      const updated = next.docs.find((entry) => entry.id === id)
      if (!updated) return
      await commit(next, { [entryKey('docs', id)]: updated })
    },

    async removeDoc(id) {
      const next = deleteEntry(requireFile(), 'docs', id)
      await commit(next, { [META_KEY]: metaFor(next) }, [entryKey('docs', id)])
      if (activeDoc === id || !next.docs.some((doc) => doc.id === activeDoc)) {
        activeDoc = next.docs[0]?.id ?? null
      }
    },

    readPassword(id) {
      const note = current?.notes.find((n) => n.id === id)
      return note ? extractPassword(note.content) : null
    },
  }
}
