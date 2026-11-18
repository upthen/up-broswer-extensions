import type { EntryKind, EntryPatch, TextEntry, WorkspaceFile } from './types'

export function createEmptyWorkspace(): WorkspaceFile {
  return { version: 2, notes: [], docs: [] }
}

const fallbackOf = (kind: EntryKind): string =>
  kind === 'docs' ? '未命名文档' : '未命名便签'

/** 标题三级兜底：手填标题 → 正文首个非空行前 24 字 → 按模块给出的默认名。 */
export function normalizeTitle(
  title: string,
  content: string,
  fallback = '未命名便签',
): string {
  const typed = String(title ?? '').trim()
  if (typed) return typed
  const firstLine = String(content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ? firstLine.slice(0, 24) : fallback
}

/** 新条目插到指定列表最前；另一类列表保持同一个引用，不产生任何隐式互通。 */
export function addEntry(
  file: WorkspaceFile,
  kind: EntryKind,
  input: { title: string; content: string },
  id: string,
  now: number,
): WorkspaceFile {
  const entry: TextEntry = {
    id,
    title: normalizeTitle(input.title, input.content, fallbackOf(kind)),
    content: input.content,
    createdAt: now,
    updatedAt: now,
  }
  return kind === 'notes'
    ? { ...file, notes: [entry, ...file.notes] }
    : { ...file, docs: [entry, ...file.docs] }
}

/** 只改传入字段与 updatedAt；id / createdAt 恒定。找不到时返回原对象。 */
export function updateEntry(
  file: WorkspaceFile,
  kind: EntryKind,
  id: string,
  patch: EntryPatch,
  now: number,
): WorkspaceFile {
  let changed = false
  const list = file[kind].map((entry) => {
    if (entry.id !== id) return entry
    changed = true
    const content = patch.content ?? entry.content
    return {
      ...entry,
      content,
      title: patch.title === undefined
        ? entry.title
        : normalizeTitle(patch.title, content, fallbackOf(kind)),
      updatedAt: now,
    }
  })
  if (!changed) return file
  return kind === 'notes' ? { ...file, notes: list } : { ...file, docs: list }
}

export function deleteEntry(file: WorkspaceFile, kind: EntryKind, id: string): WorkspaceFile {
  const list = file[kind].filter((entry) => entry.id !== id)
  return kind === 'notes' ? { ...file, notes: list } : { ...file, docs: list }
}

/**
 * 标题 + 正文，空格分词 AND，大小写不敏感。
 * 返回新数组但保留原条目引用，让 UI 能直接 v-model 到本地状态。
 */
export function searchEntries(entries: TextEntry[], query: string): TextEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...entries]
  return entries.filter((entry) => {
    const haystack = `${entry.title} ${entry.content}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function sortByUpdated(entries: TextEntry[]): TextEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

const PASSWORD_LINE = /^\s*(?:密\s*码|password|passwd|pwd)\s*[:：]\s*(.+?)\s*$/i

/**
 * 轻量识别「密码：xxx」这类行，仅供「复制密码」按钮使用。
 * 不强制格式、不解析同行、不改动正文；多行取最后一个匹配。
 */
export function extractPassword(content: string): string | null {
  let found: string | null = null
  for (const line of String(content ?? '').split(/\r?\n/)) {
    const match = line.match(PASSWORD_LINE)
    const value = match?.[1]?.trim()
    if (value) found = value
  }
  return found
}

/** 编辑器工具条显示的字数：去掉所有空白后再计。 */
export function countChars(content: string): number {
  return String(content ?? '').replace(/\s/g, '').length
}

/** 卡片摘要：跳过空行、只取前 N 行、每行超长截断；不改变存储内容。 */
export function excerpt(content: string, maxLines = 4, maxLineChars = 80): string {
  return String(content ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => (line.length > maxLineChars ? line.slice(0, maxLineChars) : line))
    .join('\n')
}
