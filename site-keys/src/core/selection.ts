/** T-41：网页选中文本 → 便签。core 层只有纯逻辑，浏览器能力由调用方注入。 */
import { addEntry, createEmptyWorkspace, normalizeTitle } from './workspace'
import { META_KEY, applyWrite, entryKey, loadWorkspace, metaFor } from './storage'
import type { KeyValueStore } from './storage'
import type { TextEntry } from './types'

/** 后台写完顺手放一个很小的通知键，界面只监听它，避免每次输入都全量读盘。 */
export const SELECTION_SIGNAL_KEY = 'sticky.selection.v3'

export interface SelectionSignal {
  ok: boolean
  id: string
  at: number
  reason?: string
}

export interface SelectionDeps {
  store: KeyValueStore
  now: () => number
  makeId: () => string
}

export interface SelectionSaver {
  /** 空白选中返回 null；落盘失败会抛错，由调用方决定是否吞掉。 */
  save(raw: string): Promise<TextEntry | null>
}

/** 只去掉首尾空白；正文内部缩进、空行、换行一律原样保留。 */
export function normalizeSelection(raw: string): string | null {
  const text = String(raw ?? '').trim()
  return text.length > 0 ? text : null
}

/** 标题沿用界面规则：首个非空行前 24 字；不追问用户、不弹窗。 */
export function makeSelectionNote(raw: string, id: string, now: number): TextEntry | null {
  const content = normalizeSelection(raw)
  if (content === null) return null
  return {
    id,
    title: normalizeTitle('', content),
    content,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 单例：串行执行，避免连续两次右键的「读索引 → 写索引」互相覆盖。
 * 每次落库前先 loadWorkspace，让 v2 / v1 旧库完成迁移，新索引才不会挡住旧数据。
 * 全新安装（无库）时直接建空索引 + 这一条便签，不额外灌示例数据。
 */
export function createSelectionSaver(deps: SelectionDeps): SelectionSaver {
  let chain: Promise<unknown> = Promise.resolve()

  const notifyFailure = async (id: string, e: unknown): Promise<void> => {
    const signal: SelectionSignal = {
      ok: false,
      id,
      at: deps.now(),
      reason: e instanceof Error ? e.message : String(e),
    }
    try { await deps.store.set(SELECTION_SIGNAL_KEY, signal) } catch { /* 通知失败也无处可报 */ }
  }

  const saveOne = async (raw: string): Promise<TextEntry | null> => {
    const content = normalizeSelection(raw)
    if (content === null) return null
    const id = deps.makeId()
    try {
      const base = (await loadWorkspace(deps.store)) ?? createEmptyWorkspace()
      const entry = makeSelectionNote(content, id, deps.now())
      if (!entry) return null
      const next = addEntry(base, 'notes', { title: '', content }, id, entry.createdAt)
      const signal: SelectionSignal = { ok: true, id, at: entry.createdAt }
      // 索引、条目、成功信号放在同一批里，不会出现「卡片在但界面没刷新」或反之。
      await applyWrite(deps.store, {
        [META_KEY]: metaFor(next),
        [entryKey('notes', id)]: entry,
        [SELECTION_SIGNAL_KEY]: signal,
      })
      return entry
    } catch (e) {
      await notifyFailure(id, e)
      throw e
    }
  }

  return {
    save(raw: string): Promise<TextEntry | null> {
      const run = chain.then(() => saveOne(raw))
      // 一次失败不能卡死后续保存
      chain = run.catch(() => undefined)
      return run
    },
  }
}
