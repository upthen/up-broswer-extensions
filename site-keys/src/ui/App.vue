<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { createWorkspaceController } from './composables/useWorkspace'
import { copyText } from './composables/useClipboard'
import { countChars, excerpt, extractPassword, searchEntries } from '../core/workspace'
import { MAX_IMPORT_BYTES, TXT_ACCEPT, planImport } from '../core/textFile'
import MarkdownEditor from './MarkdownEditor.vue'
import { SELECTION_SIGNAL_KEY } from '../core/selection'
import type { SelectionSignal } from '../core/selection'
import type { ImportSource } from '../core/textFile'
import type { Doc, ModuleId, Note } from '../core/types'

const controller = createWorkspaceController()
const notes = ref<Note[]>([])
const docs = ref<Doc[]>([])
const ready = ref(false)
const activeModule = ref<ModuleId>('stickies')
const activeDocId = ref<string | null>(null)
const query = ref('')
const toast = ref('')
const error = ref('')
/** 写入失败时一直挂着，直到有一次写入成功才清除；普通错误提示仍会自动消失。 */
const saveError = ref('')
const DEBOUNCE_MS = 250
const menuId = ref<string | null>(null)
const detailId = ref<string | null>(null)
const docDropdown = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/* ---------------- 便签详情：底部抽屉 ---------------- */
/** 初始 / 上限 / 下限都按视口高度的比例给，再叠绝对值保底，避免矮窗口下正文被压没。 */
const SHEET_INIT_RATIO = 0.5
const SHEET_MAX_RATIO = 0.8
const SHEET_MIN_RATIO = 0.3
const SHEET_MIN_PX = 200
const SHEET_GAP_PX = 16
/** 位移超过 4px 才算拖拽，否则仍然是一次点击。 */
const DRAG_THRESHOLD_PX = 4
/** 拖拽收尾的静默窗口：兜住 pointercancel、指针捕获丢失与浏览器补发的 click。 */
const VEIL_CLICK_GUARD_MS = 250
const CLOSE_MS = 160
/** 黄灯收起后只剩标题栏，这个高度刚好放下一行窗口按钮。 */
const SHEET_COLLAPSED_PX = 54
/** 侧栏与全屏页宽度差太多，高度记忆分开存，互不污染。 */
const SHEET_STORE_KEY = /sidepanel\.html$/.test(location.pathname) ? 'sticky.sheet.h.panel' : 'sticky.sheet.h.page'

const sheetH = ref(0)
const sheetDragging = ref(false)
const closing = ref(false)
const sheetMinimized = ref(false)
/** 收起前的高度只存在内存里：下次打开仍按记忆高度，细条高度不写盘。 */
let heightBeforeMinimize = 0
const sheetStyle = computed(() => (sheetH.value ? { height: `${sheetH.value}px` } : {}))

let dragFromY = 0
let dragFromH = 0
let dragPointer: number | null = null
let dragMoved = false
let dragEndedAt = 0

function sheetMinPx(): number {
  return Math.max(window.innerHeight * SHEET_MIN_RATIO, SHEET_MIN_PX)
}
function sheetMaxPx(): number {
  // 上限同时受 80% 与「视口减一条缝」约束；视口极小的时候两者可能打架，取大者兜底
  return Math.max(sheetMinPx(), Math.min(window.innerHeight * SHEET_MAX_RATIO, window.innerHeight - SHEET_GAP_PX))
}
function clampSheet(h: number): number {
  return Math.round(Math.min(Math.max(h, sheetMinPx()), sheetMaxPx()))
}
function loadSheetH(): number {
  try {
    const saved = Number(window.localStorage?.getItem(SHEET_STORE_KEY))
    if (Number.isFinite(saved) && saved > 0) return clampSheet(saved)
  } catch {
    // 隐私模式 / 配额受限时读不到就退回默认高度，不影响打开抽屉
  }
  return clampSheet(window.innerHeight * SHEET_INIT_RATIO)
}
function saveSheetH(): void {
  try {
    window.localStorage?.setItem(SHEET_STORE_KEY, String(Math.round(sheetH.value)))
  } catch {
    // 记忆高度只是体验优化，写不进去就算了
  }
}

/** 把手条与头部共用一套拖拽：向下减高、向上增高，松手即停在当前位置。 */
function beginDrag(event: PointerEvent): void {
  if (closing.value || sheetMinimized.value || event.button !== 0) return
  // 头部里的按钮不参与拖拽，否则点「关闭」会被当成起手
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input, textarea, a, select')) return
  const handle = event.currentTarget as HTMLElement
  try {
    handle.setPointerCapture?.(event.pointerId)
  } catch {
    // 指针已失效时捕获会抛 NotFoundError；这时退化成普通事件流，拖拽仍可用
  }
  dragPointer = event.pointerId
  dragFromY = event.clientY
  dragFromH = sheetH.value
  dragMoved = false
  sheetDragging.value = true
  // 鼠标不能 preventDefault：那会把 dblclick 一起吞掉，双击归位就失效了；
  // 触摸 / 触控笔则要挡掉合成 click，靠 touch-action:none + preventDefault 双保险。
  if (event.pointerType !== 'mouse') event.preventDefault()
}
function moveDrag(event: PointerEvent): void {
  if (dragPointer === null || event.pointerId !== dragPointer) return
  const delta = dragFromY - event.clientY
  if (!dragMoved && Math.abs(delta) < DRAG_THRESHOLD_PX) return
  dragMoved = true
  sheetH.value = clampSheet(dragFromH + delta)
}
function endDrag(event: PointerEvent): void {
  if (dragPointer === null || event.pointerId !== dragPointer) return
  const handle = event.currentTarget as HTMLElement
  try {
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  } catch {
    // 捕获已自然释放，无需处理
  }
  dragPointer = null
  sheetDragging.value = false
  if (dragMoved) {
    // 真正拖过才记时间点：遮罩紧接着收到的 click 一律不算关闭意图
    dragEndedAt = Date.now()
    saveSheetH()
  }
  dragMoved = false
}
/** 双击把手在「初始 50%」与「上限 80%」之间归位，避免用手拖不准。 */
function toggleSheetHeight(): void {
  if (closing.value) return
  const pivot = (sheetMinPx() + sheetMaxPx()) / 2
  const target = sheetH.value > pivot ? SHEET_INIT_RATIO : SHEET_MAX_RATIO
  sheetH.value = clampSheet(window.innerHeight * target)
  saveSheetH()
}
/** 黄灯：收起成底部细条；再按一次、点细条或点绿灯都可展开。 */
function minimizeSheet(): void {
  if (closing.value) return
  if (sheetMinimized.value) { restoreSheet(); return }
  flushWrites()
  heightBeforeMinimize = sheetH.value
  sheetMinimized.value = true
  sheetH.value = SHEET_COLLAPSED_PX
}
function restoreSheet(): void {
  if (!sheetMinimized.value) return
  sheetMinimized.value = false
  sheetH.value = clampSheet(heightBeforeMinimize || window.innerHeight * SHEET_INIT_RATIO)
}
/** 绿灯：已收起时展开并直接放大；展开时在 50% / 80% 间切换。 */
function maximizeSheet(): void {
  if (closing.value) return
  if (sheetMinimized.value) {
    restoreSheet()
    sheetH.value = clampSheet(window.innerHeight * SHEET_MAX_RATIO)
    saveSheetH()
    return
  }
  toggleSheetHeight()
}
function onHeadClick(): void {
  if (!sheetMinimized.value) return
  // 刚拖完的那一瞬不把「松手」当成展开意图，和遮罩共用同一道闸
  if (dragPointer !== null || Date.now() - dragEndedAt < VEIL_CLICK_GUARD_MS) return
  restoreSheet()
}
function onVeilClick(): void {
  // 拖拽中、或拖拽刚松手（指针飘出抽屉落在遮罩上）都不算点击遮罩
  if (dragPointer !== null || Date.now() - dragEndedAt < VEIL_CLICK_GUARD_MS) return
  closeDetail()
}
function onViewportResize(): void {
  // 收起的细条不受 30% 下限约束，别在窗口缩放时被弹回正常高度
  if (detailId.value && !sheetMinimized.value) sheetH.value = clampSheet(sheetH.value)
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !detailId.value) return
  // 中文输入法组字时按 Esc 是取消候选词，不能顺手把抽屉关掉
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  closeDetail()
}

const emptyEntry = (): Note => ({ id: '', title: '', content: '', createdAt: 0, updatedAt: 0 })
/** 详情浮层与编辑器始终绑定非空对象，避免可空值打断 v-model。 */
const draft = ref<Note>(emptyEntry())
const docDraft = ref<Doc>(emptyEntry())

/* ---------------- 记事本视图：分栏 / 源码 / 预览 ---------------- */
type DocView = 'split' | 'source' | 'preview'
const DOC_VIEW_KEY = 'sticky.doc.view'
const docView = ref<DocView>('split')

function readDocView(): DocView {
  try {
    const saved = window.localStorage?.getItem(DOC_VIEW_KEY)
    if (saved === 'split' || saved === 'source' || saved === 'preview') return saved
    // v5.1 存的是所见即所得的 wys，按语义回到分栏（左源码右预览）
    if (saved === 'wys') return 'split'
    if (saved === 'edit') return 'source'
  } catch {
    // 隐私模式读不到就用默认档
  }
  return 'split'
}
function setDocView(view: DocView): void {
  if (view === docView.value) return
  flushWrites()
  docView.value = view
  try {
    window.localStorage?.setItem(DOC_VIEW_KEY, view)
  } catch {
    // 视图偏好只是体验优化，存不进去不影响渲染
  }
}
/** 源码档改动直接回写；分栏档由 MarkdownEditor 从文本域抛上来。 */
function onEditorInput(value: string): void {
  docDraft.value.content = value
  onDocInput()
}

const shown = computed<Note[]>(() => searchEntries(notes.value, query.value))
const hasDoc = computed(() => docs.value.some((doc) => doc.id === activeDocId.value))
/** 正文自带一级标题时不再显示标题输入框，避免同一句话上下各出现一次。 */
const headingTitle = computed(() => firstHeading(docDraft.value.content))

function flash(message: string): void {
  toast.value = message
  window.setTimeout(() => { toast.value = '' }, 2200)
}
let writeFailure = false
function fail(e: unknown): void {
  // 写入失败已由 saveError 持久提示，不再重复弹一条会自动消失的普通错误。
  if (writeFailure) { writeFailure = false; return }
  error.value = e instanceof Error ? e.message : String(e)
  window.setTimeout(() => { error.value = '' }, 5000)
}

/**
 * 输入节流 + 串行写入：同一条目连续输入只在停顿时写最后一次，
 * 不同条目各自保留最后一次快照，互不覆盖；没有保存按钮、没有编辑态。
 */
let pending: Promise<void> = Promise.resolve()
const jobs = new Map<string, () => Promise<void>>()
let debounceTimer: number | undefined

function markSaveFailed(e: unknown): void {
  const reason = e instanceof Error ? e.message : String(e)
  saveError.value = `改动没有保存：${reason}。继续输入可重试，或检查浏览器存储空间后重新打开侧栏。`
}

/** 把待写任务排进串行队列；切换视图 / 关闭页面 / 执行结构操作前都会调用。 */
function flushWrites(): void {
  if (debounceTimer !== undefined) {
    window.clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  const batch = [...jobs.values()]
  jobs.clear()
  if (batch.length === 0) return
  let failed = false
  for (const job of batch) {
    pending = pending.then(job).catch((e) => { failed = true; markSaveFailed(e) })
  }
  pending = pending.then(() => { if (!failed) saveError.value = '' })
}

function queueWrite(key: string, job: () => Promise<void>): void {
  jobs.set(key, job)
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(flushWrites, DEBOUNCE_MS)
}

/** 改结构的操作先让待写任务排完队，避免与未落盘的输入抢顺序。 */
async function runAction<T>(job: () => Promise<T>): Promise<T> {
  flushWrites()
  await pending
  try {
    return await job()
  } catch (e) {
    writeFailure = true
    markSaveFailed(e)
    throw e
  }
}

function onDraftInput(): void {
  const note = draft.value
  if (!note.id) return
  const snapshot = { title: note.title, content: note.content }
  queueWrite(`note:${note.id}`, () => controller.updateNote(note.id, snapshot))
}
function onDocInput(): void {
  const doc = docDraft.value
  if (!doc.id) return
  // 正文首行是一级标题时，它就是这篇的标题：写回 doc.title，
  // 否则侧栏列表、顶栏和正文会各说各话，看着像两个标题
  const heading = firstHeading(doc.content)
  if (heading) doc.title = heading
  const snapshot = { title: doc.title, content: doc.content }
  queueWrite(`doc:${doc.id}`, () => controller.updateDoc(doc.id, snapshot))
}

/** 取正文首个非空行的 `# 标题` 文本；没有就是空串。 */
function firstHeading(content: string): string {
  const first = content.split('\n').find((line) => line.trim())
  if (!first) return ''
  return /^#\s+(.+?)\s*#*\s*$/.exec(first.trim())?.[1] ?? ''
}

function syncDocDraft(): void {
  docDraft.value = docs.value.find((doc) => doc.id === activeDocId.value) ?? emptyEntry()
}

/** 把状态机里的列表搬进界面 refs；详情浮层重新绑定到新对象，避免编辑中途失联。 */
function syncFromController(): void {
  notes.value = (controller.file?.notes ?? []).map((n) => ({ ...n }))
  docs.value = (controller.file?.docs ?? []).map((d) => ({ ...d }))
  activeModule.value = controller.activeModule
  activeDocId.value = controller.activeDocId
  if (detailId.value) {
    const fresh = notes.value.find((n) => n.id === detailId.value)
    if (fresh) draft.value = fresh
    else detailId.value = null
  }
  syncDocDraft()
  ready.value = true
}

/**
 * 后台右键保存后只写一个很小的信号键；界面只监听这个键，
 * 不会因为自己每次输入落盘而反复全量读盘。
 */
async function onSelectionSignal(signal: SelectionSignal): Promise<void> {
  if (!signal.ok) {
    fail(`保存选中内容失败：${signal.reason ?? '未知原因'}。请重新右键保存，或检查浏览器存储空间。`)
    return
  }
  // 先把未落盘的输入写掉，再读磁盘，绝不覆盖用户刚敲的字。
  flushWrites()
  await pending
  try {
    await controller.reload()
    syncFromController()
    query.value = '' // 新便签不能被当前搜索词藏起来
    menuId.value = null
    docDropdown.value = false
    flash('已存为便签')
  } catch (e) { fail(e) }
}

onMounted(() => {
  docView.value = readDocView()
  // 页面被隐藏 / 关闭前把还没到点的输入立刻排进写入队列。
  window.addEventListener('pagehide', flushWrites)
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushWrites() })
  window.addEventListener('resize', onViewportResize)
  window.addEventListener('keydown', onKeydown)
  const onChanged = typeof chrome !== 'undefined' && !!chrome.storage?.local
    ? chrome.storage.onChanged
    : undefined
  onChanged?.addListener((changes, area) => {
    if (area !== 'local') return
    const signal = changes[SELECTION_SIGNAL_KEY]?.newValue as SelectionSignal | undefined
    if (signal) void onSelectionSignal(signal)
  })
  void controller.init()
    .then(syncFromController)
    .catch((e) => { fail(e) })
})

function setModule(id: ModuleId): void {
  flushWrites()
  controller.setModule(id)
  activeModule.value = id
  menuId.value = null
  docDropdown.value = false
}

async function addNew(): Promise<void> {
  try {
    const id = await runAction(() => controller.createNote())
    const created = controller.file?.notes.find((n) => n.id === id)
    if (created) notes.value.unshift({ ...created })
    query.value = ''
    openDetailById(id)
    flash('新便签已建好，直接填就行')
  } catch (e) { fail(e) }
}

function openDetailById(id: string): void {
  flushWrites()
  const found = notes.value.find((n) => n.id === id)
  if (!found) return
  draft.value = found
  closing.value = false
  sheetMinimized.value = false
  heightBeforeMinimize = 0
  sheetH.value = loadSheetH()
  detailId.value = id
  menuId.value = null
  void nextTick(() => { document.getElementById('detail-title')?.focus() })
}
function openDetail(note: Note): void { openDetailById(note.id) }
/** 关闭先落盘、再播 160ms 下滑动画；期间锁住重复关闭。 */
function closeDetail(): void {
  if (closing.value) return
  flushWrites()
  closing.value = true
  sheetMinimized.value = false
  heightBeforeMinimize = 0
  window.setTimeout(() => {
    detailId.value = null
    closing.value = false
  }, CLOSE_MS)
}
function toggleMenu(id: string): void { menuId.value = menuId.value === id ? null : id }

async function removeNote(note: Note): Promise<void> {
  const name = note.title.trim() || '未命名便签'
  if (!window.confirm(`删除便签「${name}」？不可撤销。`)) return
  try {
    await runAction(() => controller.removeNote(note.id))
    notes.value = notes.value.filter((n) => n.id !== note.id)
    if (detailId.value === note.id) { detailId.value = null; closing.value = false }
    menuId.value = null
    flash('已删除')
  } catch (e) { fail(e) }
}

async function clearAll(): Promise<void> {
  if (!window.confirm('清空全部便签？不可撤销。')) return
  if (!window.confirm('再次确认：清空后不会恢复初始便签。')) return
  try {
    await runAction(() => controller.clearNotes())
    notes.value = []
    query.value = ''
    detailId.value = null
    closing.value = false
    flash('已清空便签')
  } catch (e) { fail(e) }
}

async function copyAll(note: Note): Promise<void> {
  const ok = await copyText(note.content)
  flash(ok ? '已复制便签内容' : '复制失败，请手动选中文字复制')
}
async function copyPassword(note: Note): Promise<void> {
  const value = extractPassword(note.content)
  if (!value) return
  const ok = await copyText(value)
  flash(ok ? '已复制密码' : '复制失败，请手动选中文字复制')
}
async function copyCurrentDoc(): Promise<void> {
  if (!docDraft.value.content) return
  const ok = await copyText(docDraft.value.content)
  flash(ok ? '已复制文档内容' : '复制失败，请手动选中文字复制')
}

async function addDoc(): Promise<void> {
  try {
    const id = await runAction(() => controller.createDoc())
    const created = controller.file?.docs.find((d) => d.id === id)
    if (created) docs.value.unshift({ ...created })
    activeDocId.value = id
    controller.setActiveDoc(id)
    syncDocDraft()
    docDropdown.value = false
    await nextTick()
    document.getElementById('editor-title')?.focus()
  } catch (e) { fail(e) }
}
function selectDoc(id: string): void {
  flushWrites()
  activeDocId.value = id
  controller.setActiveDoc(id)
  syncDocDraft()
  docDropdown.value = false
}
function toggleDocDropdown(): void { docDropdown.value = !docDropdown.value }

/** 选完即入库：一个 txt 一篇新文档，整批只写一次盘；非 txt / 超限逐个跳过不阻塞其他文件。 */
function pickFiles(): void { flushWrites(); fileInput.value?.click() }
async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = '' // 允许连续选择同一个文件
  if (picked.length === 0) return
  try {
    const sources: ImportSource[] = []
    for (const file of picked) {
      // 超限文件不读进内存，只带 size 交给 planImport 判定
      const bytes = file.size <= MAX_IMPORT_BYTES
        ? new Uint8Array(await file.arrayBuffer())
        : new Uint8Array(0)
      sources.push({ name: file.name, size: file.size, bytes })
    }
    const plan = planImport(sources)
    if (plan.entries.length > 0) {
      await runAction(() => controller.importDocs(plan.entries))
      docs.value = (controller.file?.docs ?? []).map((doc) => ({ ...doc }))
      activeDocId.value = controller.activeDocId
      syncDocDraft()
      docDropdown.value = false
    }
    const skipped = plan.skipped.length
      ? `，跳过 ${plan.skipped.length} 个（${plan.skipped[0]!.reason}）`
      : ''
    if (plan.entries.length > 0) flash(`已导入 ${plan.entries.length} 篇文档${skipped}`)
    else fail(`没有可导入的文件${skipped}`)
  } catch (e) { fail(e) }
}
async function removeDoc(doc: Doc): Promise<void> {
  const name = doc.title.trim() || '未命名文档'
  if (!window.confirm(`删除文档「${name}」？不可撤销。`)) return
  try {
    await runAction(() => controller.removeDoc(doc.id))
    docs.value = docs.value.filter((d) => d.id !== doc.id)
    activeDocId.value = controller.activeDocId
    syncDocDraft()
    docDropdown.value = false
    flash('已删除')
  } catch (e) { fail(e) }
}

function openFullPage(): void {
  flushWrites()
  const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL
  const url = inExtension ? chrome.runtime.getURL('index.html') : 'index.html'
  if (inExtension && chrome.tabs?.create) chrome.tabs.create({ url })
  else window.open(url, '_blank')
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="app">
    <!-- 内联 SVG 图标 sprite：无外部资源 -->
    <svg class="sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>
      <symbol id="i-logo" viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="17" rx="3.5"/><path d="M8 9h8M8 13h8M8 17h4"/></symbol>
      <symbol id="i-stickies" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h4"/></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/></symbol>
      <symbol id="i-expand" viewBox="0 0 24 24"><path d="M13 5h6v6M19 5l-9 9M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5L20 20"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 15V4M8.5 7.5L12 4l3.5 3.5M5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V14"/></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15.2" r="3.2"/><path d="M10.4 12.9L19 4.3M16.2 7.1l2 2M14 9.3l2 2"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.3"/><path d="M12 7.5V12l3 1.8"/></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.3"/><path d="M12 11v5M12 8h.01"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
      <symbol id="i-dots" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></symbol>
    </defs></svg>

    <header class="topbar">
      <span class="brand" title="便签本 · Sticky">
        <span class="brand__mark"><svg class="ic"><use href="#i-logo"/></svg></span>
        <span class="brand__name">便签本 <em>· Sticky</em></span>
      </span>
      <div class="seg">
        <button class="seg__item" :class="{ 'is-active': activeModule === 'stickies' }" type="button" @click="setModule('stickies')">
          <svg class="ic ic--sm"><use href="#i-stickies"/></svg>便签 <span class="seg__count">{{ notes.length }}</span>
        </button>
        <button class="seg__item" :class="{ 'is-active': activeModule === 'notebook' }" type="button" @click="setModule('notebook')">
          <svg class="ic ic--sm"><use href="#i-doc"/></svg>记事本 <span class="seg__count">{{ docs.length }}</span>
        </button>
      </div>
      <span class="topbar__spacer"/>
      <button class="btn btn--bare btn--icon" type="button" title="全屏打开" @click="openFullPage">
        <svg class="ic"><use href="#i-expand"/></svg>
      </button>
    </header>

    <p v-if="error" class="notice notice--err">{{ error }}</p>
    <p v-if="saveError" class="notice notice--err">{{ saveError }}</p>

    <!-- ============ 便签模块：小卡片 n*n 瀑布网格 ============ -->
    <template v-if="activeModule === 'stickies'">
      <div class="toolbar">
        <label class="search">
          <svg class="ic ic--sm"><use href="#i-search"/></svg>
          <input v-model="query" type="text" placeholder="搜索便签，空格分隔多词" />
        </label>
        <button class="btn btn--primary btn--new" type="button" title="新建便签" @click="addNew">
          <svg class="ic ic--sm"><use href="#i-plus"/></svg><span class="btn__label">新建便签</span>
        </button>
      </div>

      <div class="app__body">
        <div class="grid-meta"><span class="dot"/>输入即存 · 本地明文<span>{{ shown.length }} 张</span></div>

        <div v-if="!ready" class="loading-line"><span class="loading-dot"/>正在读取本地数据…</div>
        <div v-else-if="!shown.length" class="empty">
          <svg class="ic"><use href="#i-stickies"/></svg>
          <strong>{{ query.trim() ? '没有匹配的便签' : '还没有便签' }}</strong>
          <span>{{ query.trim() ? '换个关键词试试' : '点右上角「＋」新建，直接填就行' }}</span>
          <button v-if="!query.trim()" class="btn btn--primary btn--sm" type="button" @click="addNew">＋ 新建便签</button>
        </div>
        <div v-else class="stickies">
          <article
            v-for="note in shown" :key="note.id" class="sticky"
            :class="{ 'is-active': menuId === note.id || detailId === note.id }"
            @click="openDetail(note)"
          >
            <div class="sticky__ops" @click.stop>
              <button class="sticky__op" type="button" title="复制全文" @click="copyAll(note)">
                <svg class="ic"><use href="#i-copy"/></svg>
              </button>
              <button v-if="extractPassword(note.content)" class="sticky__op sticky__op--key" type="button" title="复制密码" @click="copyPassword(note)">
                <svg class="ic"><use href="#i-key"/></svg>
              </button>
              <button class="sticky__op" type="button" title="更多操作" @click="toggleMenu(note.id)">
                <svg class="ic"><use href="#i-dots"/></svg>
              </button>
            </div>
            <span class="sticky__ops-hint">···</span>
            <h3 class="sticky__title">{{ note.title }}</h3>
            <div class="sticky__excerpt">{{ excerpt(note.content) }}</div>
            <div class="sticky__foot">
              <svg class="ic"><use href="#i-clock"/></svg>{{ formatTime(note.updatedAt) }}
            </div>
            <div v-if="menuId === note.id" class="sticky__menu" @click.stop>
              <button class="sticky__menu-item" type="button" @click="openDetail(note)">
                <svg class="ic ic--sm"><use href="#i-doc"/></svg>编辑
              </button>
              <div class="sticky__menu-sep"/>
              <button class="sticky__menu-item sticky__menu-item--danger" type="button" @click="removeNote(note)">
                <svg class="ic ic--sm"><use href="#i-trash"/></svg>删除
              </button>
            </div>
          </article>
        </div>

        <div class="app-footer">
          <div class="risk">
            <svg class="ic ic--sm"><use href="#i-info"/></svg>
            <p>便签与文档都以明文保存在本机 Chrome 里，不加密、无需口令、不联网、不同步；本机任何人打开即可查看或修改。</p>
          </div>
          <div class="app-footer__actions">
            <button class="btn btn--danger btn--sm" type="button" @click="clearAll">清空全部便签</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 记事本模块：文件切换 + 整页编辑器 ============ -->
    <template v-else>
      <div class="nb">
        <aside class="nb-sidebar">
          <div class="nb-sidebar__head">文档 <span>{{ docs.length }} 篇</span></div>
          <button class="file-new" type="button" @click="addDoc">
            <svg class="ic ic--sm"><use href="#i-plus"/></svg>＋ 新建文档
          </button>
          <button class="file-new file-new--sub" type="button" title="从本地选择纯文本文件" @click="pickFiles">
            <svg class="ic ic--sm"><use href="#i-upload"/></svg>导入 txt
          </button>
          <div class="file-list">
            <div
              v-for="doc in docs" :key="doc.id" class="file-item"
              :class="{ 'is-current': doc.id === activeDocId }" @click="selectDoc(doc.id)"
            >
              <svg class="ic ic--sm file-item__ic"><use href="#i-file"/></svg>
              <div class="file-item__txt">
                <span class="file-item__name">{{ doc.title }}</span>
                <span class="file-item__meta">{{ countChars(doc.content) }} 字 · {{ formatTime(doc.updatedAt) }}</span>
              </div>
              <button class="file-item__del" type="button" title="删除文档" @click.stop="removeDoc(doc)">
                <svg class="ic ic--sm"><use href="#i-close"/></svg>
              </button>
            </div>
          </div>
          <div class="nb-sidebar__foot">
            <svg class="ic ic--sm"><use href="#i-info"/></svg>
            <span>明文保存在本机，不联网、不同步。</span>
          </div>
        </aside>

        <div class="nb-bar">
          <button class="nb-select" type="button" @click="toggleDocDropdown">
            <svg class="ic ic--sm"><use href="#i-file"/></svg>
            <span class="lbl">{{ docDraft.title || '选择文档' }}</span>
            <svg class="ic ic--sm chev"><use href="#i-chevron"/></svg>
          </button>
          <span class="nb-meta">{{ countChars(docDraft.content) }} 字</span>
          <button class="btn btn--bare btn--icon" type="button" title="复制全文" @click="copyCurrentDoc">
            <svg class="ic"><use href="#i-copy"/></svg>
          </button>
          <div v-if="docDropdown" class="nb-dropdown">
            <div class="nb-dropdown__head">切换文档 <span class="sp"/><span>{{ docs.length }} 篇</span></div>
            <button class="file-new" type="button" @click="addDoc">
              <svg class="ic ic--sm"><use href="#i-plus"/></svg>＋ 新建文档
            </button>
            <button class="file-new file-new--sub" type="button" @click="pickFiles">
              <svg class="ic ic--sm"><use href="#i-upload"/></svg>导入 txt
            </button>
            <div class="file-list">
              <div
                v-for="doc in docs" :key="doc.id" class="file-item"
                :class="{ 'is-current': doc.id === activeDocId }" @click="selectDoc(doc.id)"
              >
                <svg class="ic ic--sm file-item__ic"><use href="#i-file"/></svg>
                <div class="file-item__txt">
                  <span class="file-item__name">{{ doc.title }}</span>
                  <span class="file-item__meta">{{ countChars(doc.content) }} 字</span>
                </div>
                <button class="file-item__del" type="button" title="删除文档" @click.stop="removeDoc(doc)">
                  <svg class="ic ic--sm"><use href="#i-close"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="editor">
          <div class="editor__bar">
            <span class="editor__name">{{ docDraft.title || '未选择文档' }}</span>
            <span class="editor__sep"/>
            <span class="editor__meta">{{ countChars(docDraft.content) }} 字 · 更新 {{ formatTime(docDraft.updatedAt) }}</span>
            <span class="sp"/>
            <div class="seg seg--sm editor__view" role="group" aria-label="视图">
              <button class="seg__item" :class="{ 'is-active': docView === 'split' }" type="button" title="左边源码，右边实时预览" @click="setDocView('split')">分栏</button>
              <button class="seg__item" :class="{ 'is-active': docView === 'source' }" type="button" title="只看 Markdown 源码" @click="setDocView('source')">源码</button>
              <button class="seg__item" :class="{ 'is-active': docView === 'preview' }" type="button" title="只看排版效果" @click="setDocView('preview')">预览</button>
            </div>
            <button class="btn" type="button" @click="copyCurrentDoc">
              <svg class="ic ic--sm"><use href="#i-copy"/></svg>复制全文
            </button>
          </div>
          <div v-if="hasDoc" class="editor__page" :class="`is-${docView}`">
            <div class="editor__pane editor__pane--write">
              <input
                v-if="!headingTitle" id="editor-title" v-model="docDraft.title" class="editor__title"
                type="text" placeholder="文档标题" @input="onDocInput" @blur="flushWrites"
              />
              <MarkdownEditor
                :model-value="docDraft.content"
                :view="docView"
                placeholder="随便写：方案、命令、临时笔记… 支持 Markdown，右边实时看效果"
                @update:model-value="onEditorInput"
                @flush="flushWrites"
              />
            </div>
          </div>
          <div v-else class="empty">
            <svg class="ic"><use href="#i-doc"/></svg>
            <strong>还没有文档</strong>
            <span>点「＋ 新建文档」开始写</span>
            <button class="btn btn--primary btn--sm" type="button" @click="addDoc">＋ 新建文档</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 便签详情：底部抽屉，可上下拖拽调高 ============ -->
    <div v-if="detailId" class="detail-veil" @click.self="onVeilClick">
      <div
        class="detail"
        :class="{ 'is-dragging': sheetDragging, 'is-closing': closing, 'is-minimized': sheetMinimized }"
        :style="sheetStyle"
        role="dialog" aria-modal="true" aria-label="编辑便签"
      >
        <div
          class="detail__grip" title="拖动调整高度 · 双击在 50% / 80% 之间切换"
          @pointerdown="beginDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag"
          @dblclick="toggleSheetHeight"
        ></div>
        <div
          class="detail__head"
          @click="onHeadClick"
          @pointerdown="beginDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag"
        >
          <div class="detail__lights" role="group" aria-label="窗口控制">
            <button class="detail__light detail__light--close" type="button" title="关闭" aria-label="关闭" @click.stop="closeDetail"></button>
            <button
              class="detail__light detail__light--min" type="button"
              :title="sheetMinimized ? '展开便签' : '收起便签'" :aria-label="sheetMinimized ? '展开便签' : '收起便签'"
              @click.stop="minimizeSheet"
            ></button>
            <button
              class="detail__light detail__light--max" type="button"
              :title="sheetMinimized ? '展开并最大化' : '最大化 / 还原'" :aria-label="sheetMinimized ? '展开并最大化' : '最大化 / 还原'"
              @click.stop="maximizeSheet"
            ></button>
          </div>
          <span v-if="sheetMinimized" class="detail__restore">便签已收起 · 点这里展开</span>
          <span class="detail__meta">{{ countChars(draft.content) }} 字 · {{ formatTime(draft.updatedAt) }}</span>
          <template v-if="!sheetMinimized">
            <span class="sp"/>
            <button class="btn btn--bare btn--icon" type="button" title="复制全文" @click="copyAll(draft)">
              <svg class="ic"><use href="#i-copy"/></svg>
            </button>
            <button v-if="extractPassword(draft.content)" class="btn btn--bare btn--icon detail__act--key" type="button" title="复制密码" @click="copyPassword(draft)">
              <svg class="ic"><use href="#i-key"/></svg>
            </button>
            <button class="btn btn--bare btn--icon detail__act--danger" type="button" title="删除便签" @click="removeNote(draft)">
              <svg class="ic"><use href="#i-trash"/></svg>
            </button>
            <button class="btn btn--primary btn--sm" type="button" @click="closeDetail">完成</button>
          </template>
        </div>
        <input
          id="detail-title" v-model="draft.title" class="detail__title"
          type="text" placeholder="标题（留空自动取正文首行）" @input="onDraftInput" @blur="flushWrites"
        />
        <textarea
          v-model="draft.content" class="detail__body"
          placeholder="随便写：地址、账号、密码、命令、临时笔记… 输入即自动保存"
          spellcheck="false" @input="onDraftInput" @blur="flushWrites"
        />
      </div>
    </div>

    <input
      ref="fileInput" type="file" :accept="TXT_ACCEPT" multiple hidden
      @change="onFilesPicked"
    />

    <div v-if="toast" class="float-toast toast">
      <svg class="ic ic--sm"><use href="#i-check"/></svg>{{ toast }}
    </div>
  </div>
</template>
