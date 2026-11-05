<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseJson, toJsValue, preview as previewValue } from '@/core/json'
import { queryJsonPath, JSONPATH_PRESETS } from '@/core/query'
import type { JsonPathResult } from '@/core/query'
import Icon from './Icon.vue'
import { copyText } from '../composables/useClipboard'

const props = withDefaults(defineProps<{ text: string; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{
  (e: 'notify', message: string): void
  (e: 'repair'): void
  (e: 'use', text: string): void
}>()

const source = ref(props.text)
const expression = ref('$.*')
const exprInput = ref('$.*')
let textTimer: number | undefined
let exprTimer: number | undefined

onMounted(() => {
  source.value = props.text
})
watch(
  () => props.text,
  (value) => {
    window.clearTimeout(textTimer)
    textTimer = window.setTimeout(() => {
      source.value = value
    }, 180)
  },
)
watch(exprInput, (value) => {
  window.clearTimeout(exprTimer)
  exprTimer = window.setTimeout(() => {
    expression.value = value
  }, 180)
})
onBeforeUnmount(() => {
  window.clearTimeout(textTimer)
  window.clearTimeout(exprTimer)
})

const isEmpty = computed(() => !source.value.trim())
const parsed = computed(() => parseJson(source.value))
const parseError = computed(() => (parsed.value.ok ? null : parsed.value.error))

const result = computed<JsonPathResult | null>(() => {
  if (!parsed.value.ok) return null
  return queryJsonPath(toJsValue(parsed.value.root), expression.value)
})

const matches = computed(() => (result.value?.ok ? result.value.matches : []))
const truncated = computed(() => (result.value?.ok ? result.value.truncated : false))
const shown = computed(() => matches.value.slice(0, 300))

function usePreset(value: string) {
  exprInput.value = value
  expression.value = value
}

async function copyOne(text: string, label: string) {
  const ok = await copyText(text)
  emit('notify', ok ? `已复制${label}` : '复制失败，请手动选择')
}

async function copyAll() {
  const values = matches.value.map((match) => match.value)
  const ok = await copyText(JSON.stringify(values, null, 2))
  emit('notify', ok ? `已复制 ${values.length} 条结果` : '复制失败，请手动选择')
}

function useAsInput() {
  const values = matches.value.map((match) => match.value)
  emit('use', JSON.stringify(values.length === 1 ? values[0] : values, null, 2))
}
</script>

<template>
  <div class="query" :class="{ 'query--compact': compact }">
    <div class="query__bar">
      <div class="query__input" :class="{ 'is-error': result && !result.ok }">
        <Icon name="search" :size="13" />
        <input
          v-model="exprInput"
          type="text"
          spellcheck="false"
          placeholder="输入 JSONPath，例如 $.features[?(@.enabled == true)].title"
          aria-label="JSONPath 表达式"
          @keydown.enter.prevent="expression = exprInput"
        />
        <button class="btn btn--sm" title="立即查询" @click="expression = exprInput">
          <Icon name="search" :size="13" />
        </button>
      </div>
    </div>

    <div class="query__presets">
      <span class="query__label">快捷</span>
      <button
        v-for="preset in JSONPATH_PRESETS"
        :key="preset.expression"
        class="chip"
        :class="{ 'chip--active': exprInput === preset.expression }"
        :title="preset.expression"
        @click="usePreset(preset.expression)"
      >
        {{ preset.label }}
      </button>
      <details class="query__help">
        <summary>语法</summary>
        <div class="query__helpbody">
          <code>$.a.b</code> 子属性 · <code>$..title</code> 递归 · <code>[*]</code> 通配<br />
          <code>[0,-1]</code> 下标 · <code>[1:5:2]</code> 切片 · <code>[0,'k']</code> 联合<br />
          <code>[?(@.price &lt; 10)]</code> 过滤 · <code>[?(@.isbn)]</code> 存在 · <code>=~ /^A/</code> 正则<br />
          支持 <code>&amp;&amp; || ! ( ) == != &lt; &gt; &lt;= &gt;=</code>
        </div>
      </details>
    </div>

    <div v-if="isEmpty" class="query__empty">
      <Icon name="brackets" :size="22" />
      <strong>还没有 JSON 可查询</strong>
      <span>先在{{ compact ? '上方' : '左侧' }}输入或粘贴一段 JSON</span>
    </div>

    <div v-else-if="parseError" class="query__empty">
      <Icon name="alert" :size="22" />
      <strong>输入不是合法 JSON</strong>
      <span>第 {{ parseError.line }} 行第 {{ parseError.column }} 列 · {{ parseError.message }}</span>
      <button class="btn btn--sm" @click="emit('repair')">尝试修复输入</button>
    </div>

    <div v-else-if="result && !result.ok" class="query__err">
      <Icon name="alert" :size="15" />
      <span>{{ result.message }}</span>
      <span class="query__pos">位置 {{ result.index }}</span>
    </div>

    <template v-else>
      <div class="query__meta">
        <span class="query__count">
          命中 <strong>{{ matches.length }}</strong> 条
          <span v-if="truncated" class="query__warn">（结果过多已截断）</span>
          <span v-if="matches.length > shown.length" class="query__warn">（仅显示前 {{ shown.length }} 条）</span>
        </span>
        <span class="spacer" />
        <button class="btn btn--sm btn--ghost" :disabled="!matches.length" @click="copyAll">
          <Icon name="copy" :size="12" /> 复制结果
        </button>
        <button class="btn btn--sm btn--ghost" :disabled="!matches.length" @click="useAsInput">
          <Icon name="brackets" :size="12" /> 放回输入
        </button>
      </div>

      <div class="query__list">
        <div v-for="(match, index) in shown" :key="`${match.path}-${index}`" class="hit">
          <span class="hit__path" :title="match.path">{{ match.path }}</span>
          <span class="hit__value" :title="previewValue(match.value, 200)">{{ previewValue(match.value) }}</span>
          <span class="spacer" />
          <button class="hit__act" title="复制路径" @click="copyOne(match.path, '路径')">
            <Icon name="copy" :size="12" />
          </button>
          <button class="hit__act" title="复制该值" @click="copyOne(JSON.stringify(match.value, null, 2), '值')">
            <Icon name="brackets" :size="12" />
          </button>
        </div>
        <div v-if="!matches.length && result?.ok" class="query__none">没有匹配的节点，换个表达式试试</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}

.query__bar {
  padding: 8px 9px 6px;
  flex: none;
}

.query__input {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 4px 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.query__input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.query__input.is-error {
  border-color: var(--err);
}

.query__input > svg {
  flex: none;
  color: var(--accent);
}

.query__input input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
}

.query__presets {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding: 0 9px 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.query__label {
  font-size: 10.5px;
  color: var(--text-3);
}

.chip {
  height: 21px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 10.5px;
  cursor: pointer;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.chip--active {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.query__help {
  position: relative;
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-3);
}

.query__help summary {
  cursor: pointer;
  list-style: none;
  white-space: nowrap;
}

.query__helpbody {
  position: absolute;
  right: 0;
  z-index: 20;
  width: min(430px, 90vw);
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  box-shadow: var(--shadow-2);
  font-size: 11px;
  line-height: 1.9;
  color: var(--text-2);
}

.query__helpbody code {
  font-family: var(--font-mono);
  color: var(--accent);
}

.query__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
  flex: none;
}

.query__count strong {
  color: var(--accent);
  font-family: var(--font-mono);
}

.query__warn {
  color: var(--err);
}

.spacer {
  flex: 1 1 auto;
}

.query__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
}

.hit {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 27px;
  padding: 2px 9px;
  font-family: var(--font-mono);
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}

.hit:hover {
  background: var(--surface-2);
}

.hit__path {
  color: var(--accent);
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit__value {
  color: var(--json-string);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit__act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  flex: none;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  opacity: 0;
  padding: 0;
}

.hit:hover .hit__act,
.hit:focus-within .hit__act {
  opacity: 1;
}

.hit__act:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.query__err {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 9px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--err) 26%, transparent);
  border-radius: 8px;
  background: var(--err-soft);
  color: var(--err);
  font-size: 11.5px;
}

.query__pos {
  margin-left: auto;
  color: var(--text-3);
  font-family: var(--font-mono);
}

.query__none,
.query__empty span {
  padding: 16px 10px;
  text-align: center;
  color: var(--text-3);
  font-size: 11.5px;
}

.query__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12px;
}

.query__empty strong {
  color: var(--text);
  font-size: 13px;
}
</style>
