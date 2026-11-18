/** SPEC v4.0 §3：双模块数据模型。core 层只用这些纯数据结构，不碰浏览器 API 与 DOM。 */

/** 便签与文档的条目结构相同，但两类数据完全独立、不互通。 */
export interface TextEntry {
  id: string
  title: string
  /** 完全自由的多行文本，插件不解析、不校验、不改写 */
  content: string
  createdAt: number
  updatedAt: number
}

export type Note = TextEntry
export type Doc = TextEntry

/** 工作区里两类列表的键名，也是统一条目操作的目标。 */
export type EntryKind = 'notes' | 'docs'
export type ModuleId = 'stickies' | 'notebook'

export interface WorkspaceFile {
  version: 2
  notes: Note[]
  docs: Doc[]
}

export interface EntryPatch {
  title?: string
  content?: string
}

export interface SeedNote {
  title: string
  content: string
}
