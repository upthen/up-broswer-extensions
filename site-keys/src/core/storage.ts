import { createEmptyWorkspace } from './workspace'
import type { EntryKind, TextEntry, WorkspaceFile } from './types'

/**
 * v3 存储布局：一个 meta 键只存两类列表的 id 顺序，每条便签 / 文档各占一个键。
 * 改一条只写一条，不再每次输入序列化整个工作区。
 * WorkspaceFile.version 仍是 2（内存文档格式没变），v3 指的是磁盘布局。
 */
export const META_KEY = 'sticky.workspace.v3'
export const NOTE_PREFIX = 'sticky.note.v3.'
export const DOC_PREFIX = 'sticky.doc.v3.'
/** 以下两个键只作迁移来源：v2 整库、v1 单模块便签库。 */
export const WORKSPACE_KEY = 'sticky.workspace.v2'
export const LEGACY_NOTES_KEY = 'sticky.notes.v1'

export interface WorkspaceMeta {
  version: 3
  notes: string[]
  docs: string[]
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  /** 启动时一次取回全部键值，组装工作区 */
  getAll(): Promise<Record<string, unknown>>
  /** 同一批写入多个键：索引与条目一起落盘，避免半截状态 */
  setMany(items: Record<string, unknown>): Promise<void>
  removeMany(keys: string[]): Promise<void>
}

/** 测试用的内存实现；不依赖任何浏览器 API。 */
export class MemoryStore implements KeyValueStore {
  private data = new Map<string, unknown>()

  private copy<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value))
  }

  async get(key: string): Promise<unknown> {
    return this.copy(this.data.get(key))
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, this.copy(value))
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key)
  }

  async getAll(): Promise<Record<string, unknown>> {
    return this.copy(Object.fromEntries(this.data))
  }

  async setMany(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, this.copy(value))
  }

  async removeMany(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** 单条条目：字段缺失或类型不对就判坏，绝不半途塞进 undefined。 */
function parseEntry(raw: unknown): TextEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.content !== 'string') {
    return null
  }
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/** 任一元素不合法就整库判坏。 */
function parseEntries(value: unknown): TextEntry[] | null {
  if (!Array.isArray(value)) return null
  const out: TextEntry[] = []
  for (const item of value) {
    const entry = parseEntry(item)
    if (!entry) return null
    out.push(entry)
  }
  return out
}

/** v2 整库格式，只在迁移时读。 */
function parseWorkspace(raw: unknown): WorkspaceFile | null {
  if (!isRecord(raw) || raw.version !== 2) return null
  const notes = parseEntries(raw.notes)
  const docs = parseEntries(raw.docs)
  if (!notes || !docs) return null
  return { version: 2, notes, docs }
}

function parseLegacy(raw: unknown): TextEntry[] | null {
  return isRecord(raw) && raw.version === 1 ? parseEntries(raw.notes) : null
}

function parseMeta(raw: unknown): WorkspaceMeta | null {
  if (!isRecord(raw) || raw.version !== 3) return null
  if (!Array.isArray(raw.notes) || !Array.isArray(raw.docs)) return null
  if (!raw.notes.every((id) => typeof id === 'string')) return null
  if (!raw.docs.every((id) => typeof id === 'string')) return null
  return { version: 3, notes: [...raw.notes], docs: [...raw.docs] }
}

export function entryKey(kind: EntryKind, id: string): string {
  return (kind === 'docs' ? DOC_PREFIX : NOTE_PREFIX) + id
}

export function metaFor(file: WorkspaceFile): WorkspaceMeta {
  return {
    version: 3,
    notes: file.notes.map((entry) => entry.id),
    docs: file.docs.map((entry) => entry.id),
  }
}

/** 全量拆分：播种与迁移用，平时写入不走这里。 */
export function fullItems(file: WorkspaceFile): Record<string, unknown> {
  const items: Record<string, unknown> = { [META_KEY]: metaFor(file) }
  for (const entry of file.notes) items[entryKey('notes', entry.id)] = entry
  for (const entry of file.docs) items[entryKey('docs', entry.id)] = entry
  return items
}

/** 先写后删：中途失败只会留下孤儿键，不会丢掉已有数据。 */
export async function applyWrite(
  store: KeyValueStore,
  items: Record<string, unknown>,
  removeKeys: string[] = [],
): Promise<void> {
  if (Object.keys(items).length > 0) await store.setMany(items)
  if (removeKeys.length > 0) await store.removeMany(removeKeys)
}

function assemble(all: Record<string, unknown>, meta: WorkspaceMeta): WorkspaceFile {
  const pick = (kind: EntryKind, ids: string[]): TextEntry[] =>
    ids
      .map((id) => {
        const entry = parseEntry(all[entryKey(kind, id)])
        return entry && entry.id === id ? entry : null
      })
      .filter((entry): entry is TextEntry => entry !== null)
  return { version: 2, notes: pick('notes', meta.notes), docs: pick('docs', meta.docs) }
}

/** 写新键成功后才删旧键，迁移可重入；删旧键失败不影响下次读取（meta 优先）。 */
async function migrateToV3(store: KeyValueStore, file: WorkspaceFile): Promise<void> {
  await applyWrite(store, fullItems(file), [WORKSPACE_KEY, LEGACY_NOTES_KEY])
}

/**
 * 坏数据一律当作「无库」返回 null，由 init 决定是否播种，绝不抛异常打断 UI。
 * 优先级：v3 meta → v2 整库迁移 → v1 旧库迁移。
 */
export async function loadWorkspace(store: KeyValueStore): Promise<WorkspaceFile | null> {
  const all = await store.getAll()

  if (all[META_KEY] !== undefined) {
    const meta = parseMeta(all[META_KEY])
    return meta ? assemble(all, meta) : null
  }

  if (all[WORKSPACE_KEY] !== undefined) {
    const parsed = all[WORKSPACE_KEY] === null ? null : parseWorkspace(all[WORKSPACE_KEY])
    if (!parsed) return null
    await migrateToV3(store, parsed)
    return parsed
  }

  const legacy = parseLegacy(all[LEGACY_NOTES_KEY])
  if (!legacy) return null
  const migrated: WorkspaceFile = { version: 2, notes: legacy, docs: [] }
  await migrateToV3(store, migrated)
  return migrated
}

/** 整库覆盖：仅供播种、测试与清空使用；会清掉不再引用的条目键。 */
export async function saveWorkspace(store: KeyValueStore, file: WorkspaceFile): Promise<void> {
  const all = await store.getAll()
  const items = fullItems(file)
  const stale = Object.keys(all).filter(
    (key) => (key.startsWith(NOTE_PREFIX) || key.startsWith(DOC_PREFIX)) && !(key in items),
  )
  await applyWrite(store, items, stale)
}

/** 保留空索引键：这样用户清空后重启不会重新播种。 */
export async function clearWorkspace(store: KeyValueStore): Promise<void> {
  await saveWorkspace(store, createEmptyWorkspace())
}

/** 便签模块底部「清空全部便签」：只清便签，文档原样保留。 */
export async function clearNotes(store: KeyValueStore): Promise<void> {
  const current = await loadWorkspace(store)
  if (!current) return
  const all = await store.getAll()
  const stale = Object.keys(all).filter((key) => key.startsWith(NOTE_PREFIX))
  await applyWrite(store, { [META_KEY]: metaFor({ ...current, notes: [] }) }, stale)
}
