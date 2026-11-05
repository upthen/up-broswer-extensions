<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ENCODING_TOOLS, decodeJwt, runEncoding, toolMeta } from '@/core/encoding'
import type { Direction, EncodingOptions, EncodingToolId } from '@/core/encoding'
import Icon from '../components/Icon.vue'
import JwtResult from '../components/JwtResult.vue'
import { copyText, downloadText } from '../composables/useClipboard'

const props = withDefaults(
  defineProps<{ compact?: boolean; mode?: string; active?: boolean }>(),
  { compact: false, mode: 'full', active: true },
)

const toolId = ref<EncodingToolId>('base64')
const direction = ref<Direction>('encode')
const tool = computed(() => toolMeta(toolId.value))
const canEncode = computed(() => tool.value.directions.includes('encode'))

const initialSample = toolMeta('base64').sample()
const input = ref(initialSample)
const source = ref(initialSample)
const lastSample = ref(initialSample)

const options = reactive({
  // Base64
  urlSafe: false,
  padding: true,
  wrap: 0,
  charset: 'utf8',
  strict: false,
  // URL
  urlMode: 'component',
  urlStrict: false,
  plusAsSpace: false,
  eachLine: false,
  // Unicode
  uniStyle: 'u4',
  nonAsciiOnly: true,
  escapeControls: true,
  uppercase: false,
  // HTML
  htmlMode: 'minimal',
  decimal: false,
  htmlUppercase: false,
})

const encodingOptions = computed<EncodingOptions>(() => {
  const opts: EncodingOptions = {}
  switch (toolId.value) {
    case 'base64':
      opts.urlSafe = options.urlSafe
      opts.padding = options.padding
      opts.wrap = options.wrap
      opts.charset = options.charset
      opts.strict = options.strict
      break
    case 'url':
      opts.mode = options.urlMode
      opts.strict = options.urlStrict
      opts.plusAsSpace = options.plusAsSpace
      opts.eachLine = options.eachLine
      break
    case 'unicode':
      opts.style = options.uniStyle
      opts.nonAsciiOnly = options.nonAsciiOnly
      opts.escapeControls = options.escapeControls
      opts.uppercase = options.uppercase
      break
    case 'html':
      opts.mode = options.htmlMode
      opts.decimal = options.decimal
      opts.uppercase = options.htmlUppercase
      break
  }
  return opts
})

const result = computed(() => runEncoding(toolId.value, direction.value, source.value, encodingOptions.value))
const EMPTY_JWT = decodeJwt('')
/** 恒为非 null，模板里可以直接传给子组件 */
const jwt = computed(() => (toolId.value === 'jwt' ? decodeJwt(source.value) : EMPTY_JWT))
const outText = computed(() => (toolId.value === 'jwt' ? '' : result.value.text))

const status = computed(() => {
  if (toolId.value === 'jwt') {
    if (!source.value.trim()) return { tone: 'idle' as const, text: '等待输入 JWT' }
    return jwt.value.ok
      ? { tone: 'ok' as const, text: `解析成功 · alg ${jwt.value.algorithm} · ${jwt.value.statusText}` }
      : { tone: 'err' as const, text: jwt.value.error }
  }
  if (!source.value.trim()) return { tone: 'idle' as const, text: '等待输入' }
  if (!result.value.ok) return { tone: 'err' as const, text: result.value.error }
  return { tone: 'ok' as const, text: result.value.note || '转换完成' }
})

const warning = computed(() => (toolId.value === 'jwt' ? '' : result.value.warning))
const inBytes = computed(() => new TextEncoder().encode(input.value).length)
const outBytes = computed(() => new TextEncoder().encode(outText.value).length)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/* 输入防抖：大文本时避免每次按键都做全量转换 */
let inputTimer: number | undefined
watch(input, (value) => {
  window.clearTimeout(inputTimer)
  inputTimer = window.setTimeout(() => {
    source.value = value
  }, 120)
})
watch([toolId, direction], () => {
  window.clearTimeout(inputTimer)
  source.value = input.value
})

const toast = reactive({ visible: false, text: '' })
let toastTimer: number | undefined
function showToast(text: string) {
  toast.text = text
  toast.visible = true
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.visible = false
  }, 1800)
}

function loadSample(silent = false) {
  const text = tool.value.sample()
  input.value = text
  source.value = text
  lastSample.value = text
  if (!silent) showToast('已载入示例')
}

function selectTool(id: EncodingToolId) {
  if (id === toolId.value) return
  const previousSample = lastSample.value
  toolId.value = id
  direction.value = toolMeta(id).directions[0]
  if (!input.value.trim() || input.value === previousSample) loadSample(true)
  else source.value = input.value
}

function setDirection(next: Direction) {
  if (!tool.value.directions.includes(next)) return
  direction.value = next
}

function clearAll() {
  window.clearTimeout(inputTimer)
  input.value = ''
  source.value = ''
  lastSample.value = ''
  showToast('已清空')
}

function swap() {
  if (!outText.value) return
  window.clearTimeout(inputTimer)
  input.value = outText.value
  source.value = outText.value
  if (canEncode.value) direction.value = direction.value === 'encode' ? 'decode' : 'encode'
  showToast('结果已放回输入' + (canEncode.value ? '，方向已切换' : ''))
}

function currentOutput(): string {
  if (toolId.value === 'jwt') return jwt.value.ok ? jwt.value.payloadText : ''
  return outText.value
}

async function copyOutput() {
  const text = currentOutput()
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  showToast((await copyText(text)) ? '已复制结果' : '复制失败，请手动选择')
}

function downloadOutput() {
  const text = currentOutput()
  if (!text) {
    showToast('没有可下载的结果')
    return
  }
  const ext: Record<EncodingToolId, string> = {
    base64: 'txt',
    url: 'txt',
    unicode: 'txt',
    html: 'txt',
    jwt: 'json',
  }
  const name = `devbuddy-${toolId.value}.${ext[toolId.value]}`
  downloadText(text, name)
  showToast(`已下载 ${name}`)
}

async function pasteInput() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) {
      showToast('剪贴板里没有文本')
      return
    }
    input.value = text
    source.value = text
    showToast('已粘贴')
  } catch {
    showToast('浏览器不允许读取剪贴板，请用 Ctrl+V 粘贴')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!props.active) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    swap()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.clearTimeout(inputTimer)
  window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="enc" :class="{ 'enc--compact': compact }">
    <aside class="enc__rail">
      <div class="enc__rail-title"><Icon name="layers" :size="13" /> 编码工具</div>
      <button
        v-for="item in ENCODING_TOOLS"
        :key="item.id"
        class="toolitem"
        :class="{ 'toolitem--active': toolId === item.id }"
        :title="item.hint"
        @click="selectTool(item.id)"
      >
        <Icon :name="item.icon" :size="15" />
        <span class="toolitem__body">
          <strong>{{ item.label }}</strong>
          <small>{{ item.short }}</small>
        </span>
      </button>
      <span class="spacer" />
      <div class="enc__rail-foot"><Icon name="shield" :size="12" /> 全部在本机完成</div>
    </aside>

    <div class="enc__body">
      <div class="enc__bar">
        <div v-if="canEncode" class="dirs">
          <button :class="{ 'is-active': direction === 'encode' }" @click="setDirection('encode')">
            <Icon name="arrow" :size="12" /> 编码
          </button>
          <button :class="{ 'is-active': direction === 'decode' }" @click="setDirection('decode')">
            <Icon name="refresh" :size="12" /> 解码
          </button>
        </div>
        <span v-else class="only">仅解码</span>
        <span class="vsep" />

        <!-- Base64 -->
        <template v-if="toolId === 'base64' && direction === 'encode'">
          <label class="opt"><input v-model="options.urlSafe" type="checkbox" /> URL-safe</label>
          <label class="opt"><input v-model="options.padding" type="checkbox" /> 填充 =</label>
          <label class="field"><span>折行</span>
            <select v-model.number="options.wrap" class="select">
              <option :value="0">不折行</option>
              <option :value="64">64 字符</option>
              <option :value="76">76 字符</option>
              <option :value="100">100 字符</option>
            </select>
          </label>
          <label class="field"><span>字符集</span>
            <select v-model="options.charset" class="select">
              <option value="utf8">UTF-8</option>
              <option value="latin1">Latin-1</option>
            </select>
          </label>
        </template>
        <template v-else-if="toolId === 'base64'">
          <label class="opt"><input v-model="options.strict" type="checkbox" /> 严格校验</label>
          <span class="tiptext">自动识别 URL-safe、折行与 data URI 前缀</span>
        </template>

        <!-- URL -->
        <template v-else-if="toolId === 'url' && direction === 'encode'">
          <label class="field"><span>模式</span>
            <select v-model="options.urlMode" class="select">
              <option value="component">组件</option>
              <option value="url">完整 URL</option>
              <option value="form">表单 (+)</option>
              <option value="path">路径</option>
            </select>
          </label>
          <label class="opt"><input v-model="options.urlStrict" type="checkbox" /> 严格 3986</label>
          <label class="opt"><input v-model="options.eachLine" type="checkbox" /> 按行</label>
        </template>
        <template v-else-if="toolId === 'url'">
          <label class="opt"><input v-model="options.plusAsSpace" type="checkbox" /> + 视为空格</label>
          <label class="opt"><input v-model="options.eachLine" type="checkbox" /> 按行</label>
        </template>

        <!-- Unicode -->
        <template v-else-if="toolId === 'unicode' && direction === 'encode'">
          <label class="field"><span>风格</span>
            <select v-model="options.uniStyle" class="select">
              <option value="u4">\uXXXX</option>
              <option value="brace">\u{…}</option>
              <option value="hex">\xNN</option>
            </select>
          </label>
          <label class="opt"><input v-model="options.nonAsciiOnly" type="checkbox" /> 仅非 ASCII</label>
          <label class="opt"><input v-model="options.escapeControls" type="checkbox" /> 短转义</label>
          <label class="opt"><input v-model="options.uppercase" type="checkbox" /> 大写</label>
        </template>
        <template v-else-if="toolId === 'unicode'">
          <span class="tiptext">自动识别 \uXXXX / \u{…} / \xNN / \UXXXXXXXX / \n \t，并合并代理对</span>
        </template>

        <!-- HTML -->
        <template v-else-if="toolId === 'html' && direction === 'encode'">
          <label class="field"><span>模式</span>
            <select v-model="options.htmlMode" class="select">
              <option value="minimal">仅必要字符</option>
              <option value="nonAscii">+ 非 ASCII</option>
              <option value="all">全部转实体</option>
            </select>
          </label>
          <label class="field"><span>数字</span>
            <select v-model="options.decimal" class="select">
              <option :value="false">十六进制</option>
              <option :value="true">十进制</option>
            </select>
          </label>
          <label class="opt"><input v-model="options.htmlUppercase" type="checkbox" /> 大写</label>
        </template>
        <template v-else-if="toolId === 'html'">
          <span class="tiptext">支持 &amp;lt; &amp;#x1F680; &amp;#128640; 等命名与数字实体</span>
        </template>

        <template v-else>
          <span class="tiptext">支持 Bearer 前缀 · 展示 Header / Payload / 有效期声明</span>
        </template>

        <span class="spacer" />

        <div class="group group--tight group--end">
          <button class="btn btn--icon" title="载入示例" @click="loadSample()"><Icon name="sparkles" /></button>
          <button class="btn btn--icon" title="从剪贴板粘贴" @click="pasteInput"><Icon name="clipboard" /></button>
          <button class="btn btn--icon" title="复制结果" @click="copyOutput"><Icon name="copy" /></button>
          <button class="btn btn--icon" title="下载结果" @click="downloadOutput"><Icon name="download" /></button>
          <button v-if="canEncode" class="btn btn--icon" :disabled="!outText" title="结果放回输入并切换方向（Ctrl+Enter）" @click="swap">
            <Icon name="swap" />
          </button>
          <button class="btn btn--icon btn--danger" title="清空" @click="clearAll"><Icon name="trash" /></button>
        </div>
      </div>

      <div class="enc__hint">
        <Icon name="alert" :size="12" />
        <span>{{ tool.hint }}</span>
      </div>

      <div class="enc__panes">
        <section class="epane">
          <header class="epane__head">
            <span class="dot dot--in" />
            <span class="epane__title">输入</span>
            <span class="epane__badge">IN</span>
            <span class="spacer" />
            <span class="epane__meta">{{ input.length }} 字符 · {{ formatBytes(inBytes) }}</span>
          </header>
          <textarea
            v-model="input"
            class="epane__area"
            spellcheck="false"
            placeholder="在这里粘贴文本，右侧会实时显示转换结果"
          />
        </section>

        <section class="epane">
          <header class="epane__head">
            <span class="dot" :class="status.tone === 'err' ? 'dot--err' : 'dot--out'" />
            <span class="epane__title">{{ toolId === 'jwt' ? 'JWT 详情' : '结果' }}</span>
            <span class="epane__badge epane__badge--ghost">OUT</span>
            <span class="spacer" />
            <span v-if="toolId !== 'jwt'" class="epane__meta">{{ outText.length }} 字符 · {{ formatBytes(outBytes) }}</span>
          </header>
          <JwtResult v-if="toolId === 'jwt'" :info="jwt" :compact="compact" class="epane__fill" />
          <textarea v-else :value="outText" class="epane__area" readonly spellcheck="false" placeholder="转换结果会出现在这里" />
        </section>
      </div>

      <div class="enc__foot">
        <span class="dot" :class="`dot--${status.tone}`" />
        <span class="enc__status" :class="`enc__status--${status.tone}`">{{ status.text }}</span>
        <span v-if="warning" class="enc__warning"><Icon name="alert" :size="12" /> {{ warning }}</span>
        <span class="spacer" />
        <span class="enc__offline">纯本地 · 零网络请求</span>
      </div>
    </div>

    <transition name="pop">
      <div v-if="toast.visible" class="enc__toast">{{ toast.text }}</div>
    </transition>
  </div>
</template>

<style scoped>
.enc {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

/* ---------- 左侧工具列表 ---------- */
.enc__rail {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 166px;
  flex: none;
  padding: 10px 8px;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
  min-height: 0;
}

.enc__rail-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.4px;
}

.toolitem {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.toolitem:hover {
  background: var(--surface-3);
  color: var(--text);
}

.toolitem--active {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
  color: var(--accent);
}

.toolitem svg {
  flex: none;
}

.toolitem__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.toolitem__body strong {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.toolitem__body small {
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolitem--active .toolitem__body small {
  color: var(--accent);
  opacity: 0.8;
}

.enc__rail-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px;
  font-size: 10.5px;
  color: var(--text-3);
}

.spacer {
  flex: 1 1 auto;
}

/* ---------- 右侧工作区 ---------- */
.enc__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.enc__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 7px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.dirs {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  flex: none;
}

.dirs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.dirs button.is-active {
  background: var(--surface);
  color: var(--accent);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}

.only {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
  white-space: nowrap;
}

.opt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
  cursor: pointer;
}

.opt input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent);
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.field .select {
  height: 26px;
  font-size: 11.5px;
  background-position: calc(100% - 12px) 11px, calc(100% - 8px) 11px;
}

.tiptext {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 340px;
}

.group--tight {
  gap: 4px;
}

.group--end {
  justify-content: flex-end;
}

.enc__hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
  font-size: 11px;
  flex: none;
}

.enc__hint svg {
  flex: none;
}

.enc__hint span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 双栏 ---------- */
.enc__panes {
  flex: 1 1 auto;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  min-height: 0;
}

.epane {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

.epane__head {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex: none;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3);
  flex: none;
}

.dot--in {
  background: var(--accent);
}
.dot--out,
.dot--ok {
  background: var(--ok);
}
.dot--err {
  background: var(--err);
}
.dot--idle {
  background: var(--text-3);
}

.epane__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.epane__badge {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.epane__badge--ghost {
  background: var(--surface-3);
  color: var(--text-3);
}

.epane__meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.epane__area {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--editor-font, 13px);
  line-height: 1.65;
  tab-size: 2;
}

.epane__area::placeholder {
  color: var(--text-3);
}

.epane__fill {
  flex: 1 1 auto;
  min-height: 0;
}

/* ---------- 状态栏 ---------- */
.enc__foot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  color: var(--text-3);
  flex: none;
  flex-wrap: wrap;
}

.enc__status--ok {
  color: var(--ok);
}
.enc__status--err {
  color: var(--err);
}

.enc__warning {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--warn-soft);
  color: var(--warn);
}

.enc__offline {
  white-space: nowrap;
}

.enc__toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 90;
  padding: 7px 16px;
  border-radius: 999px;
  background: var(--text);
  color: var(--surface);
  font-size: 12px;
  box-shadow: var(--shadow-2);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.15s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}

/* ---------- 紧凑模式 ---------- */
.enc--compact {
  flex-direction: column;
}

.enc--compact .enc__rail {
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-right: none;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.enc--compact .enc__rail-title,
.enc--compact .enc__rail-foot,
.enc--compact .toolitem__body small {
  display: none;
}

.enc--compact .toolitem {
  width: auto;
  flex: none;
  padding: 5px 8px;
  gap: 5px;
}

.enc--compact .toolitem__body strong {
  font-size: 11.5px;
}

.enc--compact .enc__bar {
  padding: 6px 8px;
  gap: 5px;
}

.enc--compact .tiptext {
  display: none;
}

.enc--compact .enc__hint {
  padding: 4px 9px;
  font-size: 10.5px;
}

.enc--compact .enc__panes {
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.enc--compact .epane {
  flex: 1 1 0;
  min-height: 90px;
}

.enc--compact .epane__area {
  padding: 8px 10px;
  font-size: 12px;
}

.enc--compact .enc__foot {
  padding: 4px 9px;
  font-size: 10.5px;
}
</style>
