<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { parseJson, toJsValue } from '@/core/json'
import { generateCode, LANGUAGES } from '@/core/codegen'
import type { CodeLanguage } from '@/core/codegen'
import Icon from './Icon.vue'
import { copyText, downloadText } from '../composables/useClipboard'

const props = withDefaults(defineProps<{ text: string; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{
  (e: 'notify', message: string): void
  (e: 'repair'): void
}>()

const source = ref(props.text)
let timer: number | undefined
onMounted(() => {
  source.value = props.text
})
watch(
  () => props.text,
  (value) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      source.value = value
    }, 180)
  },
)
onBeforeUnmount(() => window.clearTimeout(timer))

const options = reactive({
  language: 'typescript' as CodeLanguage,
  rootName: 'Root',
  exportType: true,
  optionalFields: true,
  omitempty: true,
  nullable: true,
  indent: 2 as 2 | 4,
})

const isEmpty = computed(() => !source.value.trim())
const parsed = computed(() => parseJson(source.value))
const parseError = computed(() => (parsed.value.ok ? null : parsed.value.error))
const result = computed(() =>
  parsed.value.ok
    ? generateCode(toJsValue(parsed.value.root), {
        language: options.language,
        rootName: options.rootName,
        exportType: options.exportType,
        optionalFields: options.optionalFields,
        omitempty: options.omitempty,
        nullable: options.nullable,
        indent: options.indent,
      })
    : null,
)
const codeLines = computed(() => (result.value?.code ?? '').replace(/\n$/, '').split('\n'))

async function copyCode() {
  if (!result.value) return
  const ok = await copyText(result.value.code)
  emit('notify', ok ? '已复制生成的代码' : '复制失败，请手动选择')
}

function downloadCode() {
  if (!result.value) return
  const name = options.rootName.replace(/[^\w-]/g, '') || 'Root'
  downloadText(result.value.code, `${name}.${result.value.extension}`)
  emit('notify', `已下载 ${name}.${result.value.extension}`)
}
</script>

<template>
  <div class="gen" :class="{ 'gen--compact': compact }">
    <div class="gen__bar">
      <label class="gen__field" title="目标语言">
        <span>语言</span>
        <select v-model="options.language" class="select">
          <option v-for="lang in LANGUAGES" :key="lang.value" :value="lang.value">{{ lang.label }}</option>
        </select>
      </label>
      <label class="gen__field" title="根类型名称">
        <span>根名</span>
        <input v-model="options.rootName" class="input" type="text" spellcheck="false" placeholder="Root" />
      </label>
      <label class="gen__field gen__field--sm" title="缩进空格数">
        <span>缩进</span>
        <select v-model.number="options.indent" class="select">
          <option :value="2">2</option>
          <option :value="4">4</option>
        </select>
      </label>
      <span class="spacer" />
      <span v-if="result" class="gen__count">{{ result.typeCount }} 个类型</span>
    </div>

    <div class="gen__opts">
      <label class="opt"><input v-model="options.optionalFields" type="checkbox" /> 缺失字段可选</label>
      <label class="opt"><input v-model="options.nullable" type="checkbox" /> 保留 null</label>
      <label v-if="options.language === 'typescript' || options.language === 'rust'" class="opt">
        <input v-model="options.exportType" type="checkbox" /> 导出 / pub
      </label>
      <label v-if="options.language === 'go'" class="opt">
        <input v-model="options.omitempty" type="checkbox" /> omitempty
      </label>
      <span class="spacer" />
      <button class="btn btn--sm btn--ghost" :disabled="!result" @click="copyCode">
        <Icon name="copy" :size="12" /> 复制
      </button>
      <button class="btn btn--sm btn--ghost" :disabled="!result" @click="downloadCode">
        <Icon name="download" :size="12" /> 下载
      </button>
    </div>

    <div v-if="isEmpty" class="gen__empty">
      <Icon name="brackets" :size="22" />
      <strong>还没有 JSON 可生成类型</strong>
      <span>先在{{ compact ? '上方' : '左侧' }}输入或粘贴一段 JSON</span>
    </div>

    <div v-else-if="parseError" class="gen__empty">
      <Icon name="alert" :size="22" />
      <strong>无法推断类型</strong>
      <span>第 {{ parseError.line }} 行第 {{ parseError.column }} 列 · {{ parseError.message }}</span>
      <button class="btn btn--sm" @click="emit('repair')">尝试修复输入</button>
    </div>

    <div v-else class="gen__code">
      <div v-for="(line, index) in codeLines" :key="index" class="gen__line">
        <span class="gen__ln">{{ index + 1 }}</span>
        <code>{{ line || ' ' }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gen {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}

.gen__bar,
.gen__opts {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  flex: none;
  flex-wrap: wrap;
  min-width: 0;
}

.gen__bar {
  border-bottom: 1px solid var(--border);
}

.gen__opts {
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-2);
}

.gen__field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.gen__field .input,
.gen__field .select {
  height: 25px;
  font-size: 11.5px;
}

.input {
  width: 92px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  outline: none;
  font-family: var(--font-mono);
}

.input:focus {
  border-color: var(--accent);
}

.gen__field--sm .select {
  width: 52px;
}

.spacer {
  flex: 1 1 auto;
}

.gen__count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--accent);
  white-space: nowrap;
}

.opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.opt input {
  width: 13px;
  height: 13px;
  accent-color: var(--accent);
}

/* 紧凑模式：省掉字段标签，留出更多横向空间 */
.gen--compact .gen__bar,
.gen--compact .gen__opts {
  gap: 6px;
  padding: 6px 7px;
}

.gen--compact .gen__field > span {
  display: none;
}

.gen--compact .gen__field .input {
  width: 84px;
}

.gen--compact .gen__field--sm .select {
  width: 46px;
}

.gen--compact .gen__field .select {
  max-width: 104px;
}

.gen__code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 7px 0 16px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.65;
}

.gen__line {
  display: flex;
  align-items: baseline;
  min-height: 19px;
  padding-right: 10px;
  white-space: pre;
}

.gen__line:hover {
  background: var(--surface-2);
}

.gen__ln {
  flex: none;
  width: 38px;
  padding-right: 10px;
  text-align: right;
  color: var(--text-3);
  opacity: 0.65;
  user-select: none;
}

.gen__line code {
  color: var(--text);
  font-family: inherit;
}

.gen__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12px;
}

.gen__empty strong {
  color: var(--text);
  font-size: 13px;
}
</style>
