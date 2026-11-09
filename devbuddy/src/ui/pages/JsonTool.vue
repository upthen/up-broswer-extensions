<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import EdPane from '../components/EdPane.vue'
import TreeView from '../components/TreeView.vue'
import QueryPanel from '../components/QueryPanel.vue'
import CodegenPanel from '../components/CodegenPanel.vue'
import Icon from '../components/Icon.vue'
import { useSettings } from '../composables/useSettings'
import {
  escapeTransform,
  formatBytes,
  formatJsonText,
  minifyJsonText,
  parseJson,
  collectStats,
  repairJsonText,
  validateJsonText,
} from '@/core/json'
import type { IndentOption, JsonError, JsonStats, SortDirection } from '@/core/json'
import { loadValue, removeValue, saveValue } from '@/shared/storage'
import { VIEWS } from '@/shared/views'
import type { ViewMode } from '@/shared/views'

const props = withDefaults(defineProps<{ compact?: boolean; mode?: string; active?: boolean }>(), {
  compact: false,
  mode: 'full',
  active: true,
})

/** 输出区视图由外壳 App 用 v-model:view 共享，顶栏 tab 与面板内 tab 都能切换 */
const view = defineModel<ViewMode>('view', { default: 'text' })

const { settings } = useSettings()
const activeView = computed(() => VIEWS.find((item) => item.id === view.value) ?? VIEWS[0])

const HISTORY_KEY = 'devbuddy.history'
const SAMPLE = `{
  "name": "研发好朋友",
  "englishName": "DevBuddy",
  "version": "0.1.0",
  "offline": true,
  "tags": ["json", "formatter", "devtools"],
  "author": { "name": "yongbo", "email": null },
  "stats": { "downloads": 12800, "rating": 4.9, "score": 1.0e3 },
  "features": [
    { "id": 1, "title": "格式化", "enabled": true },
    { "id": 2, "title": "校验 / 修复", "enabled": true },
    { "id": 3, "title": "键排序 / 转义", "enabled": true }
  ]
}`

const input = ref(props.mode === 'full' ? SAMPLE : '')
const output = ref('')
const error = ref<JsonError | null>(null)
const inStats = ref<JsonStats | null>(null)
const outStats = ref<JsonStats | null>(null)
const immersive = ref(false)
const historyOpen = ref(false)
const busy = ref(false)

const status = reactive({
  tone: 'idle' as 'idle' | 'ok' | 'err' | 'warn',
  text: '等待输入 JSON',
  detail: '',
})

const toastState = reactive({ visible: false, text: '' })

const inputPane = ref<InstanceType<typeof EdPane> | null>(null)
const outputPane = ref<InstanceType<typeof EdPane> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const indent = computed<IndentOption>({
  get: () => settings.indent,
  set: (value) => {
    settings.indent = value
  },
})

const hasOutput = computed(() => output.value.length > 0)

const inMeta = computed(() => {
  const s = inStats.value
  if (!s) return input.value ? `${formatBytes(new TextEncoder().encode(input.value).length)}` : ''
  return `${s.lines} 行 · ${formatBytes(s.bytes)}`
})

const outMeta = computed(() => {
  if (!output.value) return ''
  const bytes = new TextEncoder().encode(output.value).length
  return outStats.value ? `${outStats.value.nodes} 节点 · ${formatBytes(bytes)}` : formatBytes(bytes)
})

const statLine = computed(() => {
  const s = inStats.value
  if (!s) return ''
  return `${s.lines} 行 · ${s.chars} 字符 · ${formatBytes(s.bytes)} · ${s.nodes} 节点 · 深度 ${s.depth}`
})

let toastTimer: number | undefined
function showToast(text: string) {
  toastState.text = text
  toastState.visible = true
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastState.visible = false
  }, 1800)
}

function refreshStats() {
  if (!input.value.trim()) {
    inStats.value = null
    return
  }
  const parsed = parseJson(input.value)
  inStats.value = parsed.ok ? collectStats(parsed.root, input.value) : null
}

let statsTimer: number | undefined
watch(input, () => {
  window.clearTimeout(statsTimer)
  statsTimer = window.setTimeout(refreshStats, 260)
})

function fail(err: JsonError) {
  error.value = err
  output.value = ''
  outStats.value = null
  status.tone = 'err'
  status.text = `第 ${err.line} 行第 ${err.column} 列 · ${err.message}`
  status.detail = err.hint ?? ''
}

function succeed(text: string, summary: string, detail = '') {
  error.value = null
  output.value = text
  outStats.value = (() => {
    const parsed = parseJson(text)
    return parsed.ok ? collectStats(parsed.root, text) : null
  })()
  status.tone = 'ok'
  status.text = summary
  status.detail = detail
}

type Action = 'format' | 'minify' | 'validate' | 'repair' | 'escape' | 'unescape'

function run(action: Action) {
  const source = input.value
  if (!source.trim()) {
    status.tone = 'warn'
    status.text = '先粘贴一段 JSON，或点「示例」试试'
    status.detail = ''
    inputPane.value?.focus()
    return
  }
  busy.value = true
  try {
    switch (action) {
      case 'format': {
        const res = formatJsonText(source, indent.value)
        if (!res.ok) return fail(res.error)
        inStats.value = res.stats
        succeed(res.output, `格式化完成 · ${res.stats.nodes} 个节点 · 深度 ${res.stats.depth}`, '键顺序保留，数字写法与转义字符原样保留')
        recordHistory(source, '格式化')
        break
      }
      case 'minify': {
        const res = minifyJsonText(source)
        if (!res.ok) return fail(res.error)
        inStats.value = res.stats
        succeed(res.output, `压缩完成 · ${formatBytes(new TextEncoder().encode(res.output).length)}`, '已移除全部空白字符')
        recordHistory(source, '压缩')
        break
      }
      case 'validate': {
        const res = validateJsonText(source)
        if (!res.ok) return fail(res.error)
        error.value = null
        inStats.value = res.stats
        status.tone = 'ok'
        status.text = `JSON 有效 · ${res.stats.nodes} 个节点 · 深度 ${res.stats.depth}`
        status.detail = `${res.stats.objects} 个对象 · ${res.stats.arrays} 个数组 · ${formatBytes(res.stats.bytes)}`
        showToast('JSON 格式正确')
        break
      }
      case 'repair': {
        const res = repairJsonText(source)
        if (!res.ok) return fail(res.error)
        if (res.alreadyValid) {
          const formatted = formatJsonText(res.text, indent.value)
          if (!formatted.ok) return fail(formatted.error)
          succeed(formatted.output, '内容本身合法，已按当前缩进重排', '无需修复')
          break
        }
        const total = res.changes.reduce((sum, item) => sum + item.count, 0)
        succeed(
          res.text,
          `修复完成 · 共 ${total} 处改动`,
          res.changes.map((item) => `${item.rule} ×${item.count}`).join(' · '),
        )
        recordHistory(source, '修复')
        break
      }
      case 'escape':
      case 'unescape': {
        const res = escapeTransform(source, action)
        if (!res.ok) return fail(res.error)
        succeed(
          res.output,
          action === 'escape' ? '已添加转义，可直接嵌入代码字符串' : '已移除转义，还原为可读文本',
          action === 'escape' ? '\\n \\t \\" \\\\ 等 8 类字符已处理' : '',
        )
        break
      }
    }
  } finally {
    busy.value = false
  }
}

function runSort(direction: SortDirection) {
  const source = input.value
  if (!source.trim()) {
    status.tone = 'warn'
    status.text = '先粘贴一段 JSON，或点「示例」试试'
    return
  }
  const res = formatJsonText(source, indent.value, direction)
  if (!res.ok) return fail(res.error)
  inStats.value = res.stats
  succeed(
    res.output,
    `键排序完成 · ${direction === 'asc' ? '升序 A→Z' : '降序 Z→A'}`,
    '递归处理对象内所有层级的键',
  )
}

async function copyResult() {
  const text = hasOutput.value ? output.value : input.value
  if (!text) {
    showToast('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    showToast(hasOutput.value ? '已复制结果' : '已复制输入')
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    showToast('已复制')
  }
}

function download() {
  const text = hasOutput.value ? output.value : input.value
  if (!text) {
    showToast('没有可下载的内容')
    return
  }
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `json-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
  showToast(`已下载 ${name}`)
}

function clearAll() {
  input.value = ''
  output.value = ''
  error.value = null
  inStats.value = null
  outStats.value = null
  status.tone = 'idle'
  status.text = '已清空'
  status.detail = ''
  inputPane.value?.focus()
}

function loadExample() {
  input.value = SAMPLE
  run('format')
  showToast('已载入示例')
}

function pickFile() {
  fileInput.value?.click()
}

async function readFile(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let text: string
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buffer)
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(buffer)
    else text = new TextDecoder('utf-8').decode(buffer)
  } catch {
    text = new TextDecoder('utf-8').decode(buffer)
  }
  input.value = text
  run('format')
  status.detail = `来源文件：${file.name}`
}

async function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) await readFile(file)
  target.value = ''
}

async function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file) await readFile(file)
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) {
      showToast('剪贴板里没有文本')
      return
    }
    input.value = text
    run('format')
  } catch {
    showToast('浏览器不允许读取剪贴板，请用 Ctrl+V 粘贴')
  }
}

function gotoError() {
  if (!error.value) return
  inputPane.value?.gotoLine(error.value.line)
}

function toggleFold() {
  if (view.value !== 'text') {
    view.value = 'text'
    showToast('已切回文本视图，可再次点击折叠')
    return
  }
  const target = hasOutput.value ? outputPane.value : inputPane.value
  if (!target) return
  if (folded.value) {
    target.unfold()
    folded.value = false
  } else {
    target.fold()
    folded.value = true
  }
}
const folded = ref(false)

function toggleImmersive() {
  immersive.value = !immersive.value
  document.body.classList.toggle('is-immersive', immersive.value)
}

function swapPane() {
  if (!hasOutput.value) return
  const next = input.value
  input.value = output.value
  output.value = next
  error.value = null
  view.value = 'text'
  refreshStats()
}

function useQueryResult(text: string) {
  input.value = text
  view.value = 'text'
  run('format')
  showToast('查询结果已放回输入')
}

function locateInInput(pos: number) {
  inputPane.value?.gotoPos(pos)
}

/* ---------------- 历史记录 ---------------- */
interface HistoryItem {
  id: string
  text: string
  time: number
  action: string
}

const history = ref<HistoryItem[]>([])

async function loadHistory() {
  history.value = await loadValue<HistoryItem[]>(HISTORY_KEY, [])
}

function recordHistory(text: string, action: string) {
  if (!text.trim()) return
  const item: HistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    time: Date.now(),
    action,
  }
  const rest = history.value.filter((h) => h.text !== text)
  history.value = [item, ...rest].slice(0, 20)
  void saveValue(HISTORY_KEY, history.value)
}

function restoreHistory(item: HistoryItem) {
  input.value = item.text
  historyOpen.value = false
  run('format')
}

async function clearHistory() {
  history.value = []
  await removeValue(HISTORY_KEY)
  showToast('历史记录已清空')
}

function previewOf(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 46 ? flat.slice(0, 46) + '…' : flat
}

function timeOf(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

/* ---------------- 全局快捷键 ---------------- */
function onKeydown(event: KeyboardEvent) {
  if (!props.active) return
  if (event.key === 'Escape') {
    if (historyOpen.value) {
      historyOpen.value = false
      return
    }
    if (immersive.value) {
      toggleImmersive()
    }
  }
  if (event.key === 'F11' && !props.compact) {
    event.preventDefault()
    toggleImmersive()
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    run('format')
  }
}

function onClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (historyOpen.value && !target.closest('.history-wrap')) historyOpen.value = false
}

onMounted(() => {
  void loadHistory()
  // 全屏页首次打开：把示例顺手排好版，让界面一进来就有输出可看
  if (props.mode === 'full' && input.value.trim()) {
    const res = formatJsonText(input.value, indent.value)
    if (res.ok) {
      input.value = res.output
      output.value = res.output
      outStats.value = res.stats
      inStats.value = res.stats
      status.tone = 'ok'
      status.text = `示例已就绪 · ${res.stats.nodes} 个节点 · 深度 ${res.stats.depth}`
      status.detail = '在这里粘贴你自己的 JSON，或把文件拖进窗口'
    }
  } else {
    refreshStats()
  }
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onClickOutside)
  document.body.classList.remove('is-immersive')
})

/** 切到别的模块时退出沉浸模式（顶栏是全局共享的） */
watch(
  () => props.active,
  (isActive) => {
    if (!isActive && immersive.value) {
      immersive.value = false
      document.body.classList.remove('is-immersive')
    }
  },
)

defineExpose({
  /** 从隐藏状态恢复显示后让 CodeMirror 重新测量尺寸 */
  refresh: () => {
    inputPane.value?.refresh()
    outputPane.value?.refresh()
  },
})
</script>

<template>
  <div class="tool" :class="{ 'tool--compact': compact }">
    <div class="toolbar">
      <div class="group group--tight">
        <span class="hintlabel" v-if="!compact">缩进</span>
        <select v-model="indent" class="select" title="缩进方式">
          <option :value="2">2 空格</option>
          <option :value="4">4 空格</option>
          <option value="tab">Tab</option>
        </select>
      </div>

      <span class="vsep" />

      <div class="group group--tight">
        <button class="btn btn--primary" title="格式化（Ctrl+Enter）" @click="run('format')">
          <Icon name="braces" />
          <span>格式化</span>
        </button>
        <button class="btn" title="校验 JSON 合法性" @click="run('validate')">校验</button>
        <button class="btn" title="自动修复常见语法问题" @click="run('repair')">修复</button>
        <button class="btn" title="压缩成单行（去除全部空白）" @click="run('minify')">压缩</button>
      </div>

      <span class="brk" v-if="compact" />

      <span class="vsep" v-if="!compact" />

      <div class="group group--tight">
        <button class="btn" :class="{ 'btn--icon': compact }" title="载入示例数据" @click="loadExample">
          <Icon name="sparkles" />
          <span v-if="!compact">示例</span>
        </button>
        <button
          class="btn"
          :class="{ 'btn--icon': compact }"
          title="打开本地 JSON 文件（也可直接拖进来）"
          @click="pickFile"
        >
          <Icon name="folder" />
          <span v-if="!compact">本地文件</span>
        </button>
        <button class="btn btn--icon" title="从剪贴板粘贴" @click="pasteFromClipboard">
          <Icon name="clipboard" />
        </button>
      </div>

      <span class="vsep" />

      <div class="group group--tight">
        <button class="btn btn--icon" title="键排序：升序 A→Z" @click="runSort('asc')">
          <Icon name="sortAsc" />
        </button>
        <button class="btn btn--icon" title="键排序：降序 Z→A" @click="runSort('desc')">
          <Icon name="sortDesc" />
        </button>
        <span v-if="!compact" class="hintlabel">键排序</span>
      </div>

      <span class="vsep" />

      <div class="group group--tight">
        <button class="btn" :class="{ 'btn--icon': compact }" title="添加转义（转成字符串字面量）" @click="run('escape')">
          <Icon name="quote" />
          <span v-if="!compact">转义</span>
        </button>
        <button class="btn" :class="{ 'btn--icon': compact }" title="移除转义" @click="run('unescape')">
          <Icon name="unquote" />
          <span v-if="!compact">去转义</span>
        </button>
      </div>

      <span class="spacer" />

      <div class="group group--tight group--end">
        <button class="btn btn--icon" title="复制结果（没有结果时复制输入）" @click="copyResult">
          <Icon name="copy" />
        </button>
        <button class="btn btn--icon" title="下载 .json 文件" @click="download">
          <Icon name="download" />
        </button>
        <button v-if="!compact" class="btn btn--icon" title="左右栏互换" :disabled="!hasOutput" @click="swapPane">
          <Icon name="swap" />
        </button>
        <button v-if="!compact" class="btn btn--icon" :title="folded ? '展开全部' : '折叠全部'" @click="toggleFold">
          <Icon name="fold" />
        </button>
        <button
          v-if="!compact"
          class="btn btn--icon"
          :title="immersive ? '退出全屏（Esc）' : '全屏编辑（F11）'"
          @click="toggleImmersive"
        >
          <Icon :name="immersive ? 'compress' : 'expand'" />
        </button>
        <button class="btn btn--icon btn--danger" title="清空" @click="clearAll">
          <Icon name="trash" />
        </button>
      </div>

      <div class="history-wrap">
        <button
          class="btn btn--icon"
          :class="{ 'is-active': historyOpen }"
          title="历史记录"
          @click.stop="historyOpen = !historyOpen"
        >
          <Icon name="clock" />
        </button>
        <transition name="pop">
          <div v-if="historyOpen" class="popover" @click.stop>
            <div class="popover__head">
              <span>本地历史（最多 20 条）</span>
              <button v-if="history.length" class="btn btn--sm btn--ghost" @click="clearHistory">清空</button>
            </div>
            <div v-if="!history.length" class="popover__empty">还没有记录，格式化一次就会出现在这里</div>
            <button
              v-for="item in history"
              :key="item.id"
              class="history-item"
              @click="restoreHistory(item)"
            >
              <span class="history-item__text">{{ previewOf(item.text) }}</span>
              <span class="history-item__meta">{{ item.action }} · {{ timeOf(item.time) }}</span>
            </button>
          </div>
        </transition>
      </div>
    </div>

    <transition name="slide">
      <div v-if="error" class="alert">
        <span class="alert__icon"><Icon name="alert" :size="16" /></span>
        <div class="alert__body">
          <div class="alert__title">第 {{ error.line }} 行第 {{ error.column }} 列 · {{ error.message }}</div>
          <div v-if="error.hint" class="alert__hint">{{ error.hint }}</div>
        </div>
        <button class="btn btn--sm" @click="gotoError">定位到错误</button>
        <button class="btn btn--sm" @click="run('repair')">尝试修复</button>
        <button class="btn btn--sm btn--ghost" title="关闭" @click="error = null">✕</button>
      </div>
    </transition>

    <div class="panes" @dragover.prevent @drop.prevent="onDrop">
      <section class="pane">
        <header class="pane__head">
          <span class="dot dot--in" />
          <span class="pane__title">输入</span>
          <span class="pane__badge">IN</span>
          <span class="spacer" />
          <span class="pane__meta">{{ inMeta }}</span>
        </header>
        <EdPane
          ref="inputPane"
          v-model="input"
          class="pane__body"
          :error-line="error ? error.line : null"
          :font-size="settings.fontSize"
          :wrap="settings.wrap"
          placeholder="在此粘贴 JSON，或把 .json 文件拖进来…"
          @format="run('format')"
          @fullscreen="toggleImmersive"
        />
      </section>

      <section class="pane">
        <header class="pane__head">
          <span class="dot" :class="hasOutput && view === 'text' ? 'dot--out' : 'dot--idle'" />
          <span class="pane__title">{{ activeView.pane }}</span>
          <span class="pane__badge pane__badge--ghost">OUT</span>
          <div class="viewtabs">
            <button
              v-for="item in VIEWS"
              :key="item.id"
              class="viewtab"
              :class="{ 'viewtab--active': view === item.id }"
              :title="`切换到${item.label}`"
              @click="view = item.id"
            >
              <Icon :name="item.icon" :size="12" :stroke="1.9" />
              <span v-if="!compact">{{ item.short }}</span>
            </button>
          </div>
          <span class="spacer" />
          <span v-if="view === 'text'" class="pane__meta">{{ outMeta }}</span>
        </header>

        <EdPane
          v-if="view === 'text'"
          ref="outputPane"
          v-model="output"
          class="pane__body"
          readonly
          :font-size="settings.fontSize"
          :wrap="settings.wrap"
          placeholder="格式化后的 JSON 会出现在这里"
        />
        <TreeView
          v-else-if="view === 'tree'"
          class="pane__body"
          :text="input"
          :compact="compact"
          @locate="locateInInput"
          @notify="showToast"
          @repair="run('repair')"
        />
        <QueryPanel
          v-else-if="view === 'query'"
          class="pane__body"
          :text="input"
          :compact="compact"
          @notify="showToast"
          @repair="run('repair')"
          @use="useQueryResult"
        />
        <CodegenPanel
          v-else
          class="pane__body"
          :text="input"
          :compact="compact"
          @notify="showToast"
          @repair="run('repair')"
        />
      </section>
    </div>

    <footer class="statusbar">
      <span class="status" :class="`status--${status.tone}`">
        <span class="status__dot" />
        <span class="status__text">{{ status.text }}</span>
        <span v-if="status.detail" class="status__detail">{{ status.detail }}</span>
      </span>
      <span class="spacer" />
      <span v-if="statLine" class="status__stats">{{ statLine }}</span>
      <span v-if="!compact" class="status__keys">
        <span class="kbd">Ctrl+F</span> 查找
        <span class="kbd">F11</span> 全屏
        <span class="kbd">Esc</span> 退出
      </span>
    </footer>

    <input
      ref="fileInput"
      type="file"
      accept=".json,.jsonc,.txt,.log,application/json"
      hidden
      @change="onFileChange"
    />

    <transition name="toast">
      <div v-if="toastState.visible" class="toast">{{ toastState.text }}</div>
    </transition>
  </div>
</template>

<style scoped>
.tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  min-width: 0;
}

.group--tight {
  gap: 4px;
}

.group--end {
  margin-left: auto;
}

.brk {
  flex-basis: 100%;
  height: 0;
}

.toolbar .is-active {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
  color: var(--accent);
}

.indent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hintlabel {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.spacer {
  flex: 1 1 auto;
}

.panes {
  flex: 1 1 auto;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  min-height: 0;
  min-width: 0;
}

.pane {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  overflow: hidden;
  transition: border-color 0.15s;
}

.pane:focus-within {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.pane__head {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 12px;
  color: var(--text-2);
  flex: none;
}

.pane__title {
  font-weight: 600;
  letter-spacing: 0.2px;
}

.pane__badge {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
}

.pane__badge--ghost {
  background: var(--surface-3);
  color: var(--text-3);
}

.pane__meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}

/* 输出区视图切换 */
.viewtabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface-3);
  flex: none;
}

.viewtab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 21px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
  font-size: 10.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}

.viewtab:hover {
  color: var(--text);
}

.viewtab--active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-1);
  font-weight: 600;
}

.tool--compact .viewtab {
  padding: 0 5px;
}

.tool--compact .pane__meta {
  display: none;
}

.pane__body {
  flex: 1 1 auto;
  min-height: 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.dot--in {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.dot--out {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}

.dot--idle {
  background: var(--border-2);
}

.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 12px 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--err) 26%, transparent);
  border-radius: var(--radius);
  background: var(--err-soft);
  color: var(--text);
}

.alert__icon {
  color: var(--err);
  display: inline-flex;
}

.alert__body {
  flex: 1;
  min-width: 0;
}

.alert__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--err);
}

.alert__hint {
  font-size: 11.5px;
  color: var(--text-2);
  margin-top: 1px;
}

.statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 30px;
  padding: 0 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-size: 11.5px;
  color: var(--text-3);
  flex: none;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-2);
  flex: none;
}

.status--ok .status__dot {
  background: var(--ok);
}

.status--err .status__dot {
  background: var(--err);
}

.status--warn .status__dot {
  background: var(--warn);
}

.status__text {
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46vw;
}

.status--err .status__text {
  color: var(--err);
}

.status--ok .status__text {
  color: var(--text);
}

.status__detail {
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 32vw;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}

.status__stats {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.status__keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* 历史弹层 */
.history-wrap {
  position: relative;
}

.popover {
  position: absolute;
  right: 0;
  top: 34px;
  width: 290px;
  max-height: 320px;
  overflow: auto;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-2);
  z-index: 60;
}

.popover__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 6px;
  font-size: 11.5px;
  color: var(--text-3);
}

.popover__empty {
  padding: 16px 8px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  transition: background 0.12s;
}

.history-item:hover {
  background: var(--surface-3);
}

.history-item__text {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item__meta {
  font-size: 10.5px;
  color: var(--text-3);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  font-size: 12.5px;
  box-shadow: var(--shadow-2);
  z-index: 90;
  pointer-events: none;
}

/* 紧凑模式 */
.tool--compact .toolbar {
  padding: 7px 10px;
  gap: 5px;
}

.tool--compact .group--tight {
  gap: 3px;
}

.tool--compact .btn {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.tool--compact .btn--icon {
  width: 28px;
  padding: 0;
}

.tool--compact .select {
  height: 28px;
  font-size: 12px;
}

.tool--compact .panes {
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
}

.tool--compact .pane {
  flex: 1 1 0;
  min-height: 0;
}

.tool--compact .status__keys,
.tool--compact .status__detail {
  display: none;
}

.tool--compact .alert {
  margin: 8px 10px 0;
  flex-wrap: wrap;
}

.tool--compact .alert__body {
  flex: 1 1 60%;
}

/* 过渡 */
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.16s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
