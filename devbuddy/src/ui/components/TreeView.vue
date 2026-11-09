<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseJson } from '@/core/json'
import type { JsonNode } from '@/core/json'
import { childPath } from '@/core/json/value'
import Icon from './Icon.vue'
import { copyText } from '../composables/useClipboard'

const props = withDefaults(defineProps<{ text: string; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{
  (e: 'locate', pos: number): void
  (e: 'notify', message: string): void
  (e: 'repair'): void
}>()

const MAX_ROWS = 3000
const source = ref(props.text)
const expanded = ref<Set<string>>(new Set(['$']))
const filterText = ref('')
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
    }, 200)
  },
)
onBeforeUnmount(() => window.clearTimeout(timer))

const isEmpty = computed(() => !source.value.trim())
const parsed = computed(() => parseJson(source.value))
const parseError = computed(() => (parsed.value.ok ? null : parsed.value.error))

interface Row {
  id: string
  depth: number
  label: string
  badge: string
  badgeText: string
  preview: string
  path: string
  start: number
  expandable: boolean
}

function scalarPreview(node: JsonNode): string {
  switch (node.type) {
    case 'string':
      return JSON.stringify(node.value)
    case 'number':
      return node.raw
    case 'boolean':
      return String(node.value)
    case 'null':
      return 'null'
    case 'object':
      return `${node.entries.length} 字段`
    case 'array':
      return `${node.items.length} 项`
  }
}

function badgeOf(node: JsonNode): { badge: string; text: string } {
  switch (node.type) {
    case 'object':
      return { badge: 'obj', text: '{}' }
    case 'array':
      return { badge: 'arr', text: '[]' }
    case 'string':
      return { badge: 'str', text: 'S' }
    case 'number':
      return { badge: 'num', text: 'N' }
    case 'boolean':
      return { badge: 'bool', text: 'B' }
    case 'null':
      return { badge: 'null', text: '∅' }
  }
}

function children(node: JsonNode): { label: string; path: string; node: JsonNode }[] {
  if (node.type === 'object') {
    return node.entries.map((entry) => ({
      label: entry.key,
      path: childPath('', entry.key),
      node: entry.value,
    }))
  }
  if (node.type === 'array') {
    return node.items.map((item, index) => ({ label: String(index), path: `[${index}]`, node: item }))
  }
  return []
}

function makeRow(node: JsonNode, label: string, path: string, depth: number): Row {
  const meta = badgeOf(node)
  return {
    id: path,
    depth,
    label,
    badge: meta.badge,
    badgeText: meta.text,
    preview: scalarPreview(node),
    path,
    start: node.start,
    expandable: node.type === 'object' || node.type === 'array',
  }
}

/** 按展开状态生成可见行；forceAll 用于搜索时忽略折叠 */
function flatten(forceAll: boolean): Row[] {
  const result = parseJson(source.value)
  if (!result.ok) return []
  const out: Row[] = []
  const walk = (node: JsonNode, label: string, path: string, depth: number): void => {
    if (out.length >= MAX_ROWS) return
    out.push(makeRow(node, label, path, depth))
    if (!(node.type === 'object' || node.type === 'array')) return
    if (!forceAll && !expanded.value.has(path)) return
    for (const child of children(node)) {
      walk(child.node, child.label, path + child.path, depth + 1)
    }
  }
  walk(result.root, 'root', '$', 0)
  return out
}

const rows = computed(() => {
  const keyword = filterText.value.trim().toLowerCase()
  if (!keyword) return flatten(false)
  return flatten(true)
    .filter((row) => row.label.toLowerCase().includes(keyword) || row.preview.toLowerCase().includes(keyword))
    .slice(0, MAX_ROWS)
})

const total = computed(() => flatten(true).length)
const truncated = computed(() => total.value > MAX_ROWS)

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function expandAll() {
  const all = flatten(true)
  expanded.value = new Set(all.filter((row) => row.expandable).map((row) => row.id))
}

function collapseAll() {
  expanded.value = new Set(['$'])
}

async function copyPath(row: Row) {
  const ok = await copyText(row.path)
  emit('notify', ok ? `已复制路径 ${row.path}` : '复制失败，请手动选择')
}

function locate(row: Row) {
  emit('locate', row.start)
}
</script>

<template>
  <div class="tree" :class="{ 'tree--compact': compact }">
    <div class="tree__bar">
      <div class="tree__search">
        <Icon name="search" :size="13" />
        <input v-model="filterText" type="search" placeholder="筛选字段名或值…" aria-label="筛选树节点" />
      </div>
      <span class="spacer" />
      <span class="tree__count">{{ rows.length }} 行</span>
      <button class="btn btn--sm btn--ghost" title="展开全部" @click="expandAll">展开</button>
      <button class="btn btn--sm btn--ghost" title="折叠全部" @click="collapseAll">折叠</button>
    </div>

    <div v-if="isEmpty" class="tree__empty">
      <Icon name="tree" :size="22" />
      <strong>还没有 JSON 可查看</strong>
      <span>先在{{ compact ? '上方' : '左侧' }}输入或粘贴一段 JSON</span>
    </div>

    <div v-else-if="parseError" class="tree__empty">
      <Icon name="alert" :size="22" />
      <strong>无法生成树形视图</strong>
      <span>第 {{ parseError.line }} 行第 {{ parseError.column }} 列 · {{ parseError.message }}</span>
      <button class="btn btn--sm" @click="emit('repair')">尝试修复输入</button>
    </div>

    <div v-else class="tree__scroll">
      <div
        v-for="row in rows"
        :key="row.id"
        class="node"
        :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
        :title="row.path"
      >
        <button
          v-if="row.expandable"
          class="node__caret"
          :class="{ 'is-open': expanded.has(row.id) }"
          :title="expanded.has(row.id) ? '折叠' : '展开'"
          @click.stop="toggle(row.id)"
        >
          <Icon name="chevron" :size="12" :stroke="2" />
        </button>
        <span v-else class="node__caret node__caret--empty" />

        <span class="node__badge" :class="`node__badge--${row.badge}`">{{ row.badgeText }}</span>
        <span class="node__label">{{ row.label }}</span>
        <span class="node__colon">:</span>
        <span class="node__preview" :class="`node__preview--${row.badge}`">{{ row.preview }}</span>

        <span class="spacer" />
        <span class="node__actions">
          <button class="node__act" title="复制 JSONPath" @click.stop="copyPath(row)">
            <Icon name="copy" :size="12" />
          </button>
          <button class="node__act" title="定位到输入源码" @click.stop="locate(row)">
            <Icon name="pin" :size="12" />
          </button>
        </span>
      </div>

      <div v-if="truncated" class="tree__more">节点过多，仅显示前 {{ MAX_ROWS }} 行；可用上方筛选缩小范围</div>
      <div v-if="!rows.length && !parseError" class="tree__more">没有匹配的节点</div>
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}

.tree__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  flex: none;
  min-width: 0;
}

.tree__search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 110px;
  max-width: 230px;
  flex: 1 1 150px;
  height: 27px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-3);
}

.tree__search:focus-within {
  border-color: var(--accent);
}

.tree__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
}

.tree__count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.spacer {
  flex: 1 1 auto;
}

.tree__scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 5px 0 10px;
}

.node {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 25px;
  padding-right: 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
}

.node:hover {
  background: var(--surface-2);
}

.node__caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 18px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--text-3);
  transition: transform 0.12s;
  cursor: pointer;
  padding: 0;
}

.node__caret.is-open {
  transform: rotate(90deg);
  color: var(--accent);
}

.node__caret--empty {
  cursor: default;
}

.node__badge {
  flex: none;
  min-width: 18px;
  height: 16px;
  padding: 0 3px;
  border-radius: 4px;
  text-align: center;
  line-height: 16px;
  font-size: 9.5px;
  font-weight: 600;
}

.node__badge--obj { background: var(--accent-soft); color: var(--accent); }
.node__badge--arr { background: var(--warn-soft, var(--accent-soft)); color: var(--warn, var(--accent)); }
.node__badge--str { background: var(--ok-soft); color: var(--ok); }
.node__badge--num { background: var(--surface-3); color: var(--text-2); }
.node__badge--bool { background: var(--err-soft); color: var(--err); }
.node__badge--null { background: var(--surface-3); color: var(--text-3); }

.node__label {
  color: var(--json-key);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}

.node__colon {
  color: var(--text-3);
}

.node__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}

.node__preview--str { color: var(--json-string); }
.node__preview--num { color: var(--json-number); }
.node__preview--bool,
.node__preview--null { color: var(--json-atom); }
.node__preview--obj,
.node__preview--arr { color: var(--text-3); font-size: 10.5px; }

.node__actions {
  display: inline-flex;
  gap: 2px;
  opacity: 0;
  flex: none;
}

.node:hover .node__actions,
.node:focus-within .node__actions {
  opacity: 1;
}

.node__act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  padding: 0;
}

.node__act:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.tree__more {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--text-3);
}

.tree__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12px;
}

.tree__empty strong {
  color: var(--text);
  font-size: 13px;
}
</style>
