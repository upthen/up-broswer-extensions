// @vitest-environment happy-dom
/**
 * v5.2：分栏编辑器 —— 左源码、右预览。
 *
 * 这里只测组件边界：源码单向流入预览、输入单向流回父组件、
 * 三档视图只切显隐不改数据、预览永远拿不到可执行的外部 HTML。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import MarkdownEditor from '../src/ui/MarkdownEditor.vue'

let app: App | null = null

function mount(initial: string, view: 'split' | 'source' | 'preview' = 'split') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const value = ref(initial)
  const current = ref(view)
  app = createApp({
    setup() {
      return () =>
        h(MarkdownEditor, {
          modelValue: value.value,
          view: current.value,
          placeholder: '写点什么',
          'onUpdate:modelValue': (next: string) => { value.value = next },
        })
    },
  })
  app.mount(host)
  return { host, value, current }
}

function type(host: HTMLElement, text: string): void {
  const textarea = host.querySelector('textarea')
  if (!textarea) throw new Error('找不到源码文本域')
  textarea.value = text
  textarea.dispatchEvent(new Event('input'))
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('分栏编辑器 · 源码与预览', () => {
  it('源码原样进文本域，预览按白名单渲染', () => {
    const { host } = mount('# 标题\n\n正文 **粗** 与 `code`')
    const textarea = host.querySelector('textarea')!
    expect(textarea.value).toBe('# 标题\n\n正文 **粗** 与 `code`')
    expect(host.querySelector('.md h1')?.textContent).toBe('标题')
    expect(host.querySelector('.md strong')?.textContent).toBe('粗')
    expect(host.querySelector('.md code')?.textContent).toBe('code')
  })

  it('输入把整段文本回抛父组件，再用新值刷新预览', async () => {
    const { host, value } = mount('')
    type(host, '- 一\n- 二')
    await nextTick()
    expect(value.value).toBe('- 一\n- 二')
    await nextTick()
    expect(host.querySelectorAll('.md li')).toHaveLength(2)
  })

  it('三档视图只切显隐，不动内容', async () => {
    const { host, current, value } = mount('## 小标题')
    const source = host.querySelector<HTMLElement>('.mdx__pane--source')!
    const preview = host.querySelector<HTMLElement>('.mdx__pane--preview')!

    current.value = 'source'
    await nextTick()
    expect(source.style.display).not.toBe('none')
    expect(preview.style.display).toBe('none')

    current.value = 'preview'
    await nextTick()
    expect(source.style.display).toBe('none')
    expect(preview.style.display).not.toBe('none')
    // 藏起来也要保持内容最新，切回来不用等重排
    expect(host.querySelector('.md h2')?.textContent).toBe('小标题')
    expect(value.value).toBe('## 小标题')
  })

  it('空文档给出提示语，且文本域有占位符', () => {
    const { host } = mount('   ')
    expect(host.querySelector('.mdx__empty')?.textContent).toContain('实时显示')
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBe('写点什么')
  })

  it('预览只收 renderMarkdown 的转义结果：脚本与事件属性都变成字面文字', () => {
    const { host } = mount('<img src=x onerror="alert(1)"><script>alert(1)</script>')
    const preview = host.querySelector('.md')!
    expect(preview.querySelector('script')).toBeNull()
    expect(preview.querySelector('[onerror]')).toBeNull()
    expect(preview.textContent).toContain('<script>')
  })
})
