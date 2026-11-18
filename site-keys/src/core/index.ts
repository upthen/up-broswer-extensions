/** SPEC v4.1：双模块工作区核心纯逻辑 barrel。 */
export const WORKSPACE_VERSION = 2

export type {
  Note, Doc, TextEntry, EntryKind, ModuleId, EntryPatch, WorkspaceFile, SeedNote,
} from './types'
export {
  addEntry, countChars, createEmptyWorkspace, deleteEntry, excerpt, extractPassword,
  normalizeTitle, searchEntries, sortByUpdated, updateEntry,
} from './workspace'
export {
  WORKSPACE_KEY, LEGACY_NOTES_KEY, META_KEY, NOTE_PREFIX, DOC_PREFIX, MemoryStore,
  applyWrite, clearNotes, clearWorkspace, entryKey, fullItems, loadWorkspace,
  metaFor, saveWorkspace,
} from './storage'
export type { KeyValueStore, WorkspaceMeta } from './storage'
export {
  MAX_IMPORT_BYTES, MAX_IMPORT_FILES, SKIP_REASON, TXT_ACCEPT,
  decodeTextFile, isTxtFile, planImport, titleFromFileName,
} from './textFile'
export type { DecodedTextFile, ImportEntry, ImportPlan, ImportSource, TextEncoding } from './textFile'
export {
  SELECTION_SIGNAL_KEY, createSelectionSaver, makeSelectionNote, normalizeSelection,
} from './selection'
export type { SelectionDeps, SelectionSaver, SelectionSignal } from './selection'
