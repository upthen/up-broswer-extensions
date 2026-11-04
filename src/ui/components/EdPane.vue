<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
  HighlightStyle,
  bracketMatching,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  unfoldAll,
} from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    placeholder?: string
    errorLine?: number | null
    fontSize?: number
    wrap?: boolean
  }>(),
  { readonly: false, placeholder: '', errorLine: null, fontSize: 13, wrap: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'format'): void
  (e: 'fullscreen'): void
}>()

const host = ref<HTMLDivElement | null>(null)
const view = shallowRef<EditorView | null>(null)

const readonlyComp = new Compartment()
const wrapComp = new Compartment()

const setErrorLine = StateEffect.define<number | null>()

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue
      if (effect.value == null) {
        next = Decoration.none
        continue
      }
      const total = tr.state.doc.lines
      const lineNo = Math.min(Math.max(1, effect.value), total)
      const line = tr.state.doc.line(lineNo)
      next = Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(line.from)])
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--json-key)' },
  { tag: tags.string, color: 'var(--json-string)' },
  { tag: tags.number, color: 'var(--json-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--json-atom)', fontWeight: '600' },
  { tag: tags.punctuation, color: 'var(--json-punct)' },
  { tag: tags.invalid, color: 'var(--err)' },
])

let suppressEmit = false

function buildExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    ...(props.readonly ? [] : [bracketMatching(), highlightActiveLine(), highlightSelectionMatches()]),
    foldGutter({ openText: '▾', closedText: '▸' }),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    json(),
    syntaxHighlighting(jsonHighlight),
    search({ top: true }),
    cmPlaceholder(props.placeholder),
    EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off' }),
    keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          emit('format')
          return true
        },
      },
      {
        key: 'F11',
        preventDefault: true,
        run: () => {
          emit('fullscreen')
          return true
        },
      },
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || suppressEmit) return
      emit('update:modelValue', update.state.doc.toString())
    }),
    errorLineField,
    readonlyComp.of(props.readonly ? EditorState.readOnly.of(true) : []),
    wrapComp.of(props.wrap ? EditorView.lineWrapping : []),
  ]
}

onMounted(() => {
  if (!host.value) return
  view.value = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: props.modelValue, extensions: buildExtensions() }),
  })
  if (props.errorLine) view.value.dispatch({ effects: setErrorLine.of(props.errorLine) })
})

onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})

watch(
  () => props.modelValue,
  (value) => {
    const instance = view.value
    if (!instance) return
    if (value === instance.state.doc.toString()) return
    suppressEmit = true
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } })
    suppressEmit = false
  },
)

watch(
  () => props.errorLine,
  (line) => {
    const instance = view.value
    if (!instance) return
    instance.dispatch({ effects: setErrorLine.of(line ?? null) })
    if (line) {
      const lineNo = Math.min(Math.max(1, line), instance.state.doc.lines)
      const pos = instance.state.doc.line(lineNo).from
      instance.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    }
  },
)

watch(
  () => props.readonly,
  (value) => {
    view.value?.dispatch({
      effects: readonlyComp.reconfigure(value ? EditorState.readOnly.of(true) : []),
    })
  },
)

watch(
  () => props.wrap,
  (value) => {
    view.value?.dispatch({
      effects: wrapComp.reconfigure(value ? EditorView.lineWrapping : []),
    })
  },
)

defineExpose({
  focus: () => view.value?.focus(),
  gotoLine: (line: number) => {
    const instance = view.value
    if (!instance) return
    const lineNo = Math.min(Math.max(1, line), instance.state.doc.lines)
    instance.dispatch({
      selection: { anchor: instance.state.doc.line(lineNo).from },
      scrollIntoView: true,
    })
    instance.focus()
  },
  fold: () => {
    if (view.value) foldAll(view.value)
  },
  unfold: () => {
    if (view.value) unfoldAll(view.value)
  },
  search: () => {
    if (view.value) openSearchPanel(view.value)
  },
})
</script>

<template>
  <div ref="host" class="edpane" :style="{ '--editor-font': `${fontSize}px` }" />
</template>

<style scoped>
.edpane {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
