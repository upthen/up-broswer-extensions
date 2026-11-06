<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  QR_CAPACITY,
  QR_COLOR_PRESETS,
  QR_DEFAULTS,
  QR_LEVELS,
  QR_SAMPLE,
  QR_SIZES,
  encodeQr,
  normalizeColor,
  qrPath,
  qrSvg,
} from '@/core/qrcode'
import type { QrDecodeResult, QrErrorLevel, QrOptions } from '@/core/qrcode'
import Icon from '../components/Icon.vue'
import { copyText, downloadText } from '../composables/useClipboard'
import { canvasToBlob, decodeQrFile, downloadBlob, drawQrToCanvas, makeQrFile } from '../composables/useQrImage'
import type { QrImageInfo } from '../composables/useQrImage'

const props = withDefaults(
  defineProps<{ compact?: boolean; mode?: string; active?: boolean }>(),
  { compact: false, mode: 'full', active: true },
)

const VERSIONS = Array.from({ length: 40 }, (_, i) => i + 1)
const tab = ref<'encode' | 'decode'>('encode')
const text = ref(QR_SAMPLE)
const form = reactive({
  level: 'M' as QrErrorLevel,
  version: 0,
  margin: 4,
  dark: QR_DEFAULTS.dark,
  light: QR_DEFAULTS.light,
  size: 512,
})

const qrOptions = computed<QrOptions>(() => ({
  level: form.level,
  version: form.version,
  margin: form.margin,
  dark: form.dark,
  light: form.light,
}))
const encoded = computed(() => encodeQr(text.value, qrOptions.value))
const code = computed(() => encoded.value.code)
const path = computed(() => (code.value ? qrPath(code.value) : ''))
const svg = computed(() => (code.value ? qrSvg(code.value, qrOptions.value, form.size) : ''))
const darkColor = computed(() => normalizeColor(form.dark, QR_DEFAULTS.dark))
const lightColor = computed(() => normalizeColor(form.light, QR_DEFAULTS.light))
const bytes = computed(() => new TextEncoder().encode(text.value).length)
const capacity = computed(() => QR_CAPACITY[form.level])
const usedPercent = computed(() => Math.min(100, Math.round((bytes.value / capacity.value) * 100)))
const levelHint = computed(() => QR_LEVELS.find((item) => item.id === form.level)?.hint ?? '')
const hint = computed(() =>
  tab.value === 'encode'
    ? '内容按 UTF-8 编码，支持中文与 emoji；导出 SVG / PNG 都在本机完成'
    : '点击选择、拖入图片或 Ctrl+V 粘贴截图；只读取本地图片，不上传',
)

const toast = reactive({ visible: false, text: '' })
let toastTimer: number | undefined
function showToast(message: string) {
  toast.text = message
  toast.visible = true
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.visible = false), 1800)
}

/* ---------------- 生成 ---------------- */
function loadSample() {
  text.value = QR_SAMPLE
  tab.value = 'encode'
  showToast('已载入示例')
}
function clearInput() {
  text.value = ''
  showToast('已清空')
}
async function pasteText() {
  try {
    const value = await navigator.clipboard.readText()
    if (!value) return showToast('剪贴板里没有文本')
    text.value = value
    showToast('已粘贴')
  } catch {
    showToast('浏览器不允许读取剪贴板，请用 Ctrl+V 粘贴')
  }
}
function setPreset(preset: (typeof QR_COLOR_PRESETS)[number]) {
  form.dark = preset.dark
  form.light = preset.light
}
async function copySvg() {
  if (!svg.value) return showToast('请先输入内容')
  showToast((await copyText(svg.value)) ? '已复制 SVG 源码' : '复制失败，请手动下载')
}
function downloadSvg() {
  if (!svg.value) return showToast('请先输入内容')
  downloadText(svg.value, `devbuddy-qr-${form.size}.svg`, 'image/svg+xml;charset=utf-8')
  showToast('已下载 SVG')
}
async function downloadPng() {
  if (!code.value) return showToast('请先输入内容')
  downloadBlob(await canvasToBlob(drawQrToCanvas(code.value, qrOptions.value, form.size)), `devbuddy-qr-${form.size}.png`)
  showToast(`已下载 ${form.size}px PNG`)
}
async function copyPng() {
  if (!code.value) return showToast('请先输入内容')
  try {
    const blob = await canvasToBlob(drawQrToCanvas(code.value, qrOptions.value, form.size))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    showToast('已复制 PNG 图片')
  } catch {
    showToast('浏览器不允许复制图片，请用「下载 PNG」')
  }
}

/* ---------------- 解码 ---------------- */
const decoded = ref<QrDecodeResult | null>(null)
const image = ref<QrImageInfo | null>(null)
const busy = ref(false)
const dragging = ref(false)
const fileEl = ref<HTMLInputElement | null>(null)

function releaseImage() {
  if (image.value) URL.revokeObjectURL(image.value.url)
  image.value = null
}
async function handleFile(file?: File | null) {
  if (!file) return
  busy.value = true
  releaseImage()
  const outcome = await decodeQrFile(file)
  decoded.value = outcome.result
  image.value = outcome.info
  busy.value = false
  showToast(outcome.result.ok ? '识别成功' : '未识别到二维码')
}
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void handleFile(input.files?.[0])
  input.value = ''
}
function onDrop(event: DragEvent) {
  dragging.value = false
  void handleFile(event.dataTransfer?.files?.[0])
}
async function loadSampleImage() {
  const source = text.value.trim() || QR_SAMPLE
  const result = encodeQr(source, qrOptions.value)
  if (!result.ok || !result.code) return showToast(result.error)
  busy.value = true
  try {
    await handleFile(await makeQrFile(result.code, qrOptions.value, 512))
  } catch {
    showToast('示例图片生成失败')
  } finally {
    busy.value = false
  }
}
function clearImage() {
  releaseImage()
  decoded.value = null
  showToast('已清空')
}
function useAsInput() {
  if (!decoded.value?.ok) return showToast('没有可放回的识别结果')
  text.value = decoded.value.text
  tab.value = 'encode'
  showToast('结果已放回生成输入')
}
async function copyDecoded() {
  if (!decoded.value?.ok) return showToast('没有可复制的结果')
  showToast((await copyText(decoded.value.text)) ? '已复制识别结果' : '复制失败，请手动选择')
}
function downloadDecoded() {
  if (!decoded.value?.ok) return showToast('没有可下载的结果')
  downloadText(decoded.value.text, 'devbuddy-qr-decoded.txt')
  showToast('已下载识别结果')
}

function onPaste(event: ClipboardEvent) {
  if (!props.active || tab.value !== 'decode') return
  const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  void handleFile(file)
}
function onKeydown(event: KeyboardEvent) {
  if (!props.active) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && tab.value === 'decode') {
    event.preventDefault()
    useAsInput()
  }
}
function onDragOverDoc(event: DragEvent) {
  if (props.active) event.preventDefault()
}

const status = computed(() => {
  if (tab.value === 'encode') {
    if (!text.value) return { tone: 'idle' as const, text: '等待输入内容' }
    if (!encoded.value.ok) return { tone: 'err' as const, text: encoded.value.error }
    return { tone: 'ok' as const, text: encoded.value.note }
  }
  if (busy.value) return { tone: 'idle' as const, text: '正在识别图片…' }
  if (decoded.value) {
    return decoded.value.ok
      ? { tone: 'ok' as const, text: decoded.value.note }
      : { tone: 'err' as const, text: decoded.value.error }
  }
  return { tone: 'idle' as const, text: '等待图片：点击选择、拖入或 Ctrl+V 粘贴' }
})
const warning = computed(() => (tab.value === 'encode' ? encoded.value.warning : decoded.value?.warning ?? ''))
const decodedText = computed(() => decoded.value?.text ?? '')

onMounted(() => {
  document.addEventListener('paste', onPaste)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('dragover', onDragOverDoc)
})
onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('dragover', onDragOverDoc)
  window.clearTimeout(toastTimer)
  releaseImage()
})
</script>

<template>
  <div class="qr" :class="{ 'qr--compact': compact }">
    <div class="qr__bar">
      <div class="qr__tabs">
        <button :class="{ 'is-active': tab === 'encode' }" @click="tab = 'encode'">
          <Icon name="qr" :size="13" /> 生成二维码
        </button>
        <button :class="{ 'is-active': tab === 'decode' }" @click="tab = 'decode'">
          <Icon name="scan" :size="13" /> 解码图片
        </button>
      </div>
      <span class="vsep" />
      <span class="qr__hint"><Icon name="alert" :size="12" /> {{ hint }}</span>
      <span class="spacer" />

      <div v-if="tab === 'encode'" class="group group--tight group--end">
        <button class="btn btn--icon" title="载入示例" @click="loadSample"><Icon name="sparkles" /></button>
        <button class="btn btn--icon" title="从剪贴板粘贴" @click="pasteText"><Icon name="clipboard" /></button>
        <button class="btn btn--icon" title="复制 SVG" @click="copySvg"><Icon name="code" /></button>
        <button class="btn btn--icon" title="复制图片" @click="copyPng"><Icon name="copy" /></button>
        <button class="btn btn--icon" title="下载 SVG" @click="downloadSvg"><Icon name="download" /></button>
        <button class="btn btn--icon btn--danger" title="清空" @click="clearInput"><Icon name="trash" /></button>
      </div>
      <div v-else class="group group--tight group--end">
        <button class="btn btn--icon" title="载入示例二维码" @click="loadSampleImage"><Icon name="sparkles" /></button>
        <button class="btn btn--icon" title="选择图片" @click="fileEl?.click()"><Icon name="image" /></button>
        <button class="btn btn--icon" title="复制结果" @click="copyDecoded"><Icon name="copy" /></button>
        <button class="btn btn--icon" title="下载结果" @click="downloadDecoded"><Icon name="download" /></button>
        <button class="btn btn--icon btn--danger" title="清空图片" @click="clearImage"><Icon name="trash" /></button>
      </div>
    </div>

    <div class="qr__panes">
      <!-- 生成：输入 + 设置 -->
      <section v-if="tab === 'encode'" class="pane">
        <header class="pane__head">
          <span class="dot dot--in" />
          <span class="pane__title">内容</span>
          <span class="pane__badge">IN</span>
          <span class="spacer" />
          <span class="pane__meta">{{ text.length }} 字符 · {{ bytes }} 字节</span>
        </header>
        <textarea
          v-model="text"
          class="qr__input"
          spellcheck="false"
          placeholder="输入网址、文本、Wi-Fi 配置或任意内容，右侧实时生成二维码"
        />
        <div class="qr__capacity">
          <span>容量</span>
          <div class="qr__track"><i :style="{ width: usedPercent + '%' }" :class="{ 'is-full': bytes > capacity }" /></div>
          <span class="qr__captext">{{ bytes }} / {{ capacity }} B（{{ form.level }}）</span>
        </div>
        <div class="qr__settings">
          <label class="set">
            <span>纠错等级</span>
            <select v-model="form.level" class="select">
              <option v-for="item in QR_LEVELS" :key="item.id" :value="item.id">{{ item.label }} · {{ item.rate }}</option>
            </select>
          </label>
          <span class="set__hint">{{ levelHint }}</span>
          <label class="set">
            <span>版本</span>
            <select v-model.number="form.version" class="select">
              <option :value="0">自动（推荐）</option>
              <option v-for="v in VERSIONS" :key="v" :value="v">V{{ v }} · {{ 17 + v * 4 }}×{{ 17 + v * 4 }}</option>
            </select>
          </label>
          <label class="set">
            <span>静区</span>
            <select v-model.number="form.margin" class="select">
              <option :value="4">4 模块（规范）</option>
              <option :value="2">2 模块</option>
              <option :value="0">无</option>
              <option :value="8">8 模块</option>
            </select>
          </label>
          <label class="set">
            <span>导出尺寸</span>
            <select v-model.number="form.size" class="select">
              <option v-for="size in QR_SIZES" :key="size" :value="size">{{ size }} × {{ size }} px</option>
            </select>
          </label>
          <div class="set">
            <span>配色</span>
            <div class="presets">
              <button
                v-for="preset in QR_COLOR_PRESETS"
                :key="preset.label"
                class="preset"
                :class="{ 'preset--active': form.dark === preset.dark && form.light === preset.light }"
                :title="preset.label"
                @click="setPreset(preset)"
              >
                <i :style="{ background: preset.dark }" />
              </button>
              <input v-model="form.dark" type="color" title="前景色" class="color" />
              <input v-model="form.light" type="color" title="背景色" class="color" />
            </div>
          </div>
        </div>
      </section>

      <!-- 解码：图片投放 -->
      <section v-else class="pane">
        <header class="pane__head">
          <span class="dot dot--in" />
          <span class="pane__title">图片</span>
          <span class="pane__badge">IMAGE</span>
          <span class="spacer" />
          <span v-if="image" class="pane__meta">{{ image.width }}×{{ image.height }}</span>
        </header>
        <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden @change="onFileChange" />
        <div
          class="qr__drop"
          :class="{ 'qr__drop--over': dragging, 'qr__drop--has': !!image }"
          @click="fileEl?.click()"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <img v-if="image" :src="image.url" class="qr__thumb" alt="待识别图片" />
          <div v-else class="qr__drop-empty">
            <span class="qr__drop-icon"><Icon name="image" :size="26" :stroke="1.4" /></span>
            <strong>点击选择 / 拖入图片</strong>
            <small>也可以直接 Ctrl+V 粘贴截图</small>
          </div>
          <span v-if="image" class="qr__filename">{{ image.name }}</span>
        </div>
        <div class="qr__drop-tips">
          <span><Icon name="shield" :size="12" /> 图片只在本机 Canvas 中处理</span>
          <span>支持 PNG / JPG / WebP / GIF</span>
        </div>
      </section>

      <!-- 生成：预览 -->
      <section v-if="tab === 'encode'" class="pane">
        <header class="pane__head">
          <span class="dot" :class="encoded.ok ? 'dot--out' : 'dot--err'" />
          <span class="pane__title">预览</span>
          <span class="pane__badge pane__badge--ghost">OUT</span>
          <span class="spacer" />
          <span v-if="code" class="pane__meta">V{{ code.version }} · {{ code.size }}×{{ code.size }}</span>
        </header>
        <div class="qr__stage">
          <div v-if="code" class="qr__card">
            <svg
              class="qr__svg"
              :viewBox="`0 0 ${code.total} ${code.total}`"
              shape-rendering="crispEdges"
              role="img"
              aria-label="二维码预览"
            >
              <rect :width="code.total" :height="code.total" :fill="lightColor" />
              <path :d="path" :fill="darkColor" />
            </svg>
          </div>
          <div v-else class="qr__empty">
            <Icon name="qr" :size="30" :stroke="1.3" />
            <span>{{ text ? encoded.error : '输入内容后这里会显示二维码' }}</span>
          </div>
        </div>
        <div class="qr__actions">
          <button class="btn btn--primary" :disabled="!code" @click="downloadPng">
            <Icon name="download" :size="13" /> 下载 PNG
          </button>
          <button class="btn" :disabled="!code" @click="downloadSvg">下载 SVG</button>
          <button class="btn" :disabled="!code" @click="copyPng">复制图片</button>
        </div>
      </section>

      <!-- 解码：结果 -->
      <section v-else class="pane">
        <header class="pane__head">
          <span class="dot" :class="decoded?.ok ? 'dot--out' : decoded ? 'dot--err' : 'dot--idle'" />
          <span class="pane__title">识别结果</span>
          <span class="pane__badge pane__badge--ghost">OUT</span>
          <span class="spacer" />
          <span v-if="decoded?.ok" class="pane__meta">{{ decoded.text.length }} 字符</span>
        </header>
        <textarea
          class="qr__result"
          :value="decodedText"
          readonly
          spellcheck="false"
          placeholder="识别到的内容会出现在这里"
        />
        <div class="qr__actions">
          <button class="btn btn--primary" :disabled="!decoded?.ok" @click="useAsInput">
            <Icon name="arrow" :size="13" /> 放回生成输入
          </button>
          <button class="btn" :disabled="!decoded?.ok" @click="copyDecoded">复制结果</button>
          <button class="btn" :disabled="!decoded?.ok" @click="downloadDecoded">下载 TXT</button>
        </div>
      </section>
    </div>

    <div class="qr__foot">
      <span class="dot" :class="`dot--${status.tone}`" />
      <span class="qr__status" :class="`qr__status--${status.tone}`">{{ status.text }}</span>
      <span v-if="warning" class="qr__warning"><Icon name="alert" :size="12" /> {{ warning }}</span>
      <span class="spacer" />
      <span class="qr__offline">纯本地 · 零网络请求</span>
    </div>

    <transition name="pop">
      <div v-if="toast.visible" class="qr__toast">{{ toast.text }}</div>
    </transition>
  </div>
</template>

<style scoped>
.qr {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.qr__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 7px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.qr__tabs {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  flex: none;
}

.qr__tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.qr__tabs button.is-active {
  background: var(--surface);
  color: var(--accent);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}

.qr__hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}

.qr__hint svg {
  flex: none;
}

.group--tight {
  gap: 4px;
}

.group--end {
  justify-content: flex-end;
}

.spacer {
  flex: 1 1 auto;
}

.qr__panes {
  flex: 1 1 auto;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  min-height: 0;
}

.pane {
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

.pane__head {
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

.dot--in,
.dot--ok {
  background: var(--accent);
}
.dot--out {
  background: var(--ok);
}
.dot--err {
  background: var(--err);
}
.dot--idle {
  background: var(--text-3);
}

.pane__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.pane__badge {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.pane__badge--ghost {
  background: var(--surface-3);
  color: var(--text-3);
}

.pane__meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.qr__input,
.qr__result {
  flex: 1 1 auto;
  width: 100%;
  min-height: 80px;
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

.qr__input::placeholder,
.qr__result::placeholder {
  color: var(--text-3);
}

.qr__capacity {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text-3);
  flex: none;
}

.qr__track {
  flex: 1 1 auto;
  height: 4px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.qr__track i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.2s;
}

.qr__track i.is-full {
  background: var(--err);
}

.qr__captext {
  font-family: var(--font-mono);
  white-space: nowrap;
}

.qr__settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 10px;
  padding: 9px 12px 11px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  flex: none;
  max-height: 214px;
  overflow-y: auto;
}

.set {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-3);
}

.set .select {
  width: 100%;
  height: 27px;
  font-size: 11.5px;
  background-position: calc(100% - 12px) 12px, calc(100% - 8px) 12px;
}

.set__hint {
  align-self: center;
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.4;
}

.presets {
  display: flex;
  align-items: center;
  gap: 5px;
}

.preset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.preset i {
  width: 13px;
  height: 13px;
  border-radius: 3px;
}

.preset--active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.color {
  width: 26px;
  height: 24px;
  padding: 1px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}

/* ---------- 预览 ---------- */
.qr__stage {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 12px;
  background: var(--surface-2);
  overflow: auto;
}

.qr__card {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  box-shadow: var(--shadow-2);
}

.qr__svg {
  display: block;
  width: min(100%, 232px);
  height: auto;
  aspect-ratio: 1;
}

.qr__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 220px;
  color: var(--text-3);
  font-size: 12px;
  text-align: center;
  line-height: 1.6;
}

.qr__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 9px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  flex: none;
}

/* ---------- 解码 ---------- */
.qr__drop {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 0;
  margin: 12px;
  padding: 12px;
  border: 1.5px dashed var(--border-2);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}

.qr__drop:hover,
.qr__drop--over {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.qr__drop--has {
  border-style: solid;
  padding: 8px;
}

.qr__drop-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  color: var(--text-2);
  text-align: center;
}

.qr__drop-empty strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.qr__drop-empty small {
  font-size: 11px;
  color: var(--text-3);
}

.qr__drop-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
}

.qr__thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

.qr__filename {
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(16, 24, 40, 0.72);
  color: #fff;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qr__drop-tips {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 10.5px;
  color: var(--text-3);
  flex: none;
  flex-wrap: wrap;
}

.qr__drop-tips span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ---------- 状态栏 ---------- */
.qr__foot {
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

.qr__status--ok {
  color: var(--ok);
}
.qr__status--err {
  color: var(--err);
}

.qr__warning {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--warn-soft);
  color: var(--warn);
}

.qr__offline {
  white-space: nowrap;
}

.qr__toast {
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
.qr--compact .qr__bar {
  padding: 6px 8px;
  gap: 5px;
}

.qr--compact .qr__hint,
.qr--compact .vsep {
  display: none;
}

.qr--compact .qr__panes {
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.qr--compact .pane {
  flex: 1 1 0;
  min-height: 108px;
}

.qr--compact .qr__settings {
  grid-template-columns: 1fr;
  max-height: 132px;
  padding: 7px 10px;
  gap: 5px;
}

.qr--compact .set__hint,
.qr--compact .qr__capacity {
  display: none;
}

.qr--compact .qr__input,
.qr--compact .qr__result {
  padding: 8px 10px;
  font-size: 12px;
  min-height: 56px;
}

.qr--compact .qr__stage {
  padding: 8px;
}

.qr--compact .qr__svg {
  width: min(100%, 140px);
}

.qr--compact .qr__card {
  padding: 6px;
}

.qr--compact .qr__actions {
  padding: 6px 8px;
  gap: 5px;
}

.qr--compact .qr__actions .btn {
  height: 26px;
  padding: 0 8px;
  font-size: 11.5px;
}

.qr--compact .qr__drop {
  margin: 8px;
}

.qr--compact .qr__drop-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.qr--compact .qr__drop-tips span:last-child {
  display: none;
}

.qr--compact .qr__foot {
  padding: 4px 9px;
  font-size: 10.5px;
}
</style>
