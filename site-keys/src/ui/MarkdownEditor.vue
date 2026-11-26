<template>
  <div class="mdx" :class="`mdx--${view}`">
    <section v-show="view !== 'preview'" class="mdx__pane mdx__pane--source">
      <textarea
        ref="sourceEl"
        v-model="value"
        class="mdx__input"
        :placeholder="placeholder ?? ''"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        wrap="soft"
        aria-label="Markdown 源码"
        @scroll.passive="onScroll"
        @blur="emit('flush')"
      ></textarea>
    </section>
    <section v-show="view !== 'source'" ref="previewPane" class="mdx__pane mdx__pane--preview">
      <div ref="previewEl" class="md md-doc"></div>
      <p v-if="empty" class="mdx__empty">左边写 Markdown，这里实时显示排版效果</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * v5.2：Markdown 分栏编辑器 —— 左边源码，右边实时预览。
 *
 * v5.1 的所见即所得（直接编辑渲染结果 + 反向序列化）交互面太大，
 * 光标、拆块、合并、撤销各自都要自己实现，bug 难以收敛。
 * 这一版退回「文本域 + 渲染结果」：源码永远是真源，预览只是派生物，
 * 浏览器原生撤销 / 输入法 / 选区全部免费可用。
 *
 * 三条约定：
 * 1. 文本域用 v-model 写回父组件，父组件是唯一真源，组件内不留副本；
 * 2. 预览只接收 renderMarkdown() 的转义结果，不碰任何外部 HTML；
 * 3. 重排前记住阅读比例，重排后按比例还原，输入时右侧阅读位置不会跳回顶部。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '../core/markdown'

type View = 'split' | 'source' | 'preview'

const props = defineProps<{ modelValue: string; view: View; placeholder?: string }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'flush'): void
}>()

const sourceEl = ref<HTMLTextAreaElement | null>(null)
const previewPane = ref<HTMLElement | null>(null)
const previewEl = ref<HTMLElement | null>(null)
const empty = computed(() => props.modelValue.trim() === '')

/**
 * 文本域走 v-model 写回父组件，而不是自己接 input：
 * v-model 自带 compositionstart / compositionend 守卫，中文组字期间不会被重新赋值打断。
 */
const value = computed<string>({
  get: () => props.modelValue,
  set: (next) => emit('update:modelValue', next),
})

/** 滚动条当前位置占可滚动区间的比例；没有可滚空间时返回 0。 */
function ratioOf(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight
  return max > 0 ? el.scrollTop / max : 0
}

function paint(): void {
  const pane = previewPane.value
  const body = previewEl.value
  if (!pane || !body) return
  const at = ratioOf(pane)
  body.innerHTML = renderMarkdown(props.modelValue)
  // innerHTML 重建会把滚动位置清零，长文档里每敲一个字都弹回顶部
  const max = pane.scrollHeight - pane.clientHeight
  pane.scrollTop = max > 0 ? at * max : 0
}

/* 源码滚动 → 预览按同比例跟随。只在分栏档生效，且不做反向同步，避免两栏互相拉扯。 */
let scrollFrame = 0
function syncFromSource(): void {
  const source = sourceEl.value
  const pane = previewPane.value
  if (!source || !pane || props.view !== 'split') return
  const max = pane.scrollHeight - pane.clientHeight
  if (max <= 0) return
  pane.scrollTop = ratioOf(source) * max
}

function onScroll(): void {
  if (props.view !== 'split' || scrollFrame) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0
    syncFromSource()
  })
}

watch(() => props.modelValue, paint)
watch(
  () => props.view,
  (view) => {
    // 从源码 / 预览切回分栏时，右侧先对齐到左侧当前位置
    if (view === 'split') void nextTick(syncFromSource)
  },
)

onMounted(paint)
</script>
