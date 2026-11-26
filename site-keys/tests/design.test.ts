import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const css = read('src/ui/styles/base.css')
const app = read('src/ui/App.vue')

describe('T-34 · 设计系统 token 完整落地 design/mockup.html', () => {
  it('设计稿文件存在', () => {
    expect(existsSync(resolve(root, 'design/mockup.html'))).toBe(true)
  })

  it('配色 / 布局 / 阴影 / 字号 token 与设计稿一致', () => {
    for (const token of [
      '--accent:#3b5bdb', '--bg:#f8f8f6', '--surface:#ffffff', '--surface-2:#f7f8f7',
      '--text:#1b2430', '--muted:#8a94a3', '--accent-soft:#eef1fd',
      '--danger:#c23b33', '--ok:#12805a', '--highlight:#fff2b8',
      '--nav-w:240px', '--topbar-h:52px', '--seg-h:32px', '--card-min:150px',
      '--shadow-pop', '--fs-2xl:28px', '--dur-base:180ms',
    ]) {
      expect(css.replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';')).toContain(token)
    }
  })

  it('包含设计稿的全部关键组件类', () => {
    for (const selector of [
      '.topbar', '.seg', '.seg__item', '.toolbar', '.search', '.stickies', '.sticky',
      '.sticky__ops', '.sticky__menu', '.detail-veil', '.detail', '.app-footer',
      '.nb', '.nb-sidebar', '.nb-bar', '.nb-dropdown', '.file-list', '.file-item',
      '.editor', '.editor__page', '.editor__title', '.mdx__input', '.mdx__pane',
      '.float-toast', '.empty', '.sprite',
    ]) {
      expect(css).toContain(selector)
    }
  })

  it('便签瀑布有 2 / 3 / 4 列规则，且用媒体查询切换', () => {
    expect(css).toMatch(/columns:\s*2/)
    expect(css).toMatch(/columns:\s*3/)
    expect(css).toMatch(/columns:\s*4/)
    expect(css).toMatch(/@media[^{]*min-width:\s*700px/)
    expect(css).toMatch(/@media[^{]*min-width:\s*900px/)
  })

  it('整页编辑器无边框、不可拖拽缩放、占满剩余高度', () => {
    const rule = css.match(/\.mdx__input\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/border:\s*0/)
    expect(rule).toMatch(/resize:\s*none/)
    expect(rule).toMatch(/flex:\s*1/)
  })

  it('不引用任何外部资源，且不含 v3 的单列大卡片样式', () => {
    expect(css).not.toMatch(/url\(\s*['"]?https?:/)
    expect(css).not.toContain('@import')
    expect(css).not.toContain('.note-card')
  })
})

describe('T-35 · App.vue 按设计稿实现双模块', () => {
  it('顶栏分段切换器含两个模块与数量徽章', () => {
    expect(app).toContain('class="seg"')
    expect(app).toContain('便签')
    expect(app).toContain('记事本')
    expect(app).toContain('seg__count')
    expect(app).toContain('setModule')
  })

  it('便签模块：网格、卡片、hover 角标、⋯ 菜单、详情浮层、搜索新建清空', () => {
    for (const part of [
      'class="stickies"', 'class="sticky"', 'sticky__ops', 'sticky__menu',
      'detail-veil', 'detail__title', 'detail__body',
      'v-model="query"', '新建便签', '清空全部便签',
      '复制全文', '复制密码', 'searchEntries',
    ]) {
      expect(app).toContain(part)
    }
  })

  it('记事本模块：文件栏 / 下拉 / 整页编辑器 / 文档操作', () => {
    for (const part of [
      'nb-sidebar', 'nb-bar', 'nb-dropdown', 'file-list', 'file-item',
      'editor__page', 'editor__title', 'MarkdownEditor',
      '新建文档', 'setActiveDoc', 'activeDocId',
    ]) {
      expect(app).toContain(part)
    }
  })

  it('图标用内联 SVG sprite，不引外部资源', () => {
    expect(app).toContain('<symbol id="i-logo"')
    expect(app).toContain('<symbol id="i-stickies"')
    expect(app).toContain('<use href="#i-')
    expect(app).not.toMatch(/https?:\/\/[^"' ]*\.(png|jpg|svg|woff|css|js)/)
  })

  it('输入即存走串行队列，无保存按钮与编辑态切换', () => {
    expect(app).toContain('pending')
    expect(app).toContain('@input')
    expect(app).not.toContain('>保存<')
    expect(app).not.toContain('isEditing')
  })

  it('保留全屏打开入口（T-27 回归）', () => {
    expect(app).toContain("getURL('index.html')")
    expect(app).toMatch(/chrome\.tabs\??\.create/)
  })

  it('不做模块互通，也没有旧账号库 / 加密 / 导出概念', () => {
    for (const word of ['转为文档', '主密码', '解锁', '立即锁定', 'PBKDF2', 'AES-GCM', 'scope', 'pathPrefix', 'note-card', '导出']) {
      expect(app).not.toContain(word)
    }
  })

  it('v4.1 记事本导入入口：文件栏与下拉都沿用次级按钮样式', () => {
    expect(app).toContain('type="file"')
    expect(app).toContain('导入 txt')
    expect(app).toContain('file-new--sub')
    expect(css).toContain('.file-new--sub')
  })
})

describe('T-36 · 便签详情改为可拖拽的底部抽屉', () => {
  const rule = (selector: string) => css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('遮罩底部对齐，抽屉从下方升起', () => {
    const veil = rule('.detail-veil')
    expect(veil).toMatch(/align-items:\s*flex-end/)
    expect(veil).not.toMatch(/place-items:\s*center/)
    expect(css).toMatch(/@keyframes\s+sheetIn/)
    expect(css).toMatch(/@keyframes\s+sheetOut/)
  })

  it('正文吃满剩余高度，且不再依赖原生 resize 手柄', () => {
    const body = rule('.detail__body')
    expect(body).toMatch(/resize:\s*none/)
    expect(body).toMatch(/flex:\s*1/)
    expect(css).not.toContain('resize: vertical')
  })

  it('把手条是独立拖拽热区', () => {
    expect(app).toContain('detail__grip')
    expect(rule('.detail__grip')).toMatch(/touch-action:\s*none/)
    expect(rule('.detail__grip')).toMatch(/cursor:\s*grab/)
  })

  it('高度档位：初始 50% / 上限 80% / 下限 30%，并带绝对值保底', () => {
    expect(app).toContain('SHEET_INIT_RATIO = 0.5')
    expect(app).toContain('SHEET_MAX_RATIO = 0.8')
    expect(app).toContain('SHEET_MIN_RATIO = 0.3')
    expect(app).toMatch(/SHEET_MIN_PX = \d+/)
    expect(app).toContain('clampSheet')
  })

  it('拖拽用指针捕获 + 位移阈值 + 时间闸，避免把松手当成点击遮罩', () => {
    expect(app).toContain('setPointerCapture')
    expect(app).toContain('DRAG_THRESHOLD_PX')
    expect(app).toContain('VEIL_CLICK_GUARD_MS')
    expect(app).toContain('dragEndedAt')
    // 遮罩点击守卫生效时提前返回，不再无条件关闭
    expect(app).toMatch(/function onVeilClick\(\)[\s\S]{0,400}?dragPointer !== null[\s\S]{0,300}?return/)
  })

  it('关闭仍有明确出口：遮罩 / 关闭按钮 / 完成 / Esc，且下拖不关闭', () => {
    expect(app).toContain('@click.self="onVeilClick"')
    expect(app).toContain("event.key !== 'Escape'")
    expect(app).toContain('event.isComposing')
    expect(app).toMatch(/function closeDetail\(\)[\s\S]{0,200}?closing\.value = true/)
    // 只有「拖到 30% 到底」不触发关闭：高度 clamp，无 overflow-dismiss 逻辑
    expect(app).not.toContain('dismissOnDrag')
  })

  it('高度记忆按侧栏 / 全屏页分键存储', () => {
    expect(app).toContain('sticky.sheet.h.panel')
    expect(app).toContain('sticky.sheet.h.page')
    expect(app).toContain('localStorage')
  })
})

describe('T-42 四期 · 窗口式红黄绿三灯', () => {
  const rule = (selector: string) => css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('头部左上角是红黄绿三灯，红关 / 黄收起 / 绿最大化', () => {
    expect(app).toContain('detail__lights')
    for (const name of ['close', 'min', 'max']) {
      expect(app).toContain(`detail__light--${name}`)
      // 三个按钮都必须阻止冒泡，否则点黄灯会被头部的「点细条展开」立刻还原
      expect(app).toContain(`@click.stop="${{ close: 'closeDetail', min: 'minimizeSheet', max: 'maximizeSheet' }[name as 'close' | 'min' | 'max']}"`)
    }
  })

  it('三色沿用 macOS 窗口色，悬停整组才显出 × − +', () => {
    for (const [name, color] of [['close', '#ff5f57'], ['min', '#febc2e'], ['max', '#28c840']]) {
      expect(rule(`.detail__light--${name}`)).toContain(color)
      expect(css).toContain(`.detail__light--${name}::after`)
    }
    expect(css).toContain('.detail__lights:hover .detail__light::after')
    expect(css).toContain("content: '×'")
    expect(css).toContain("content: '−'")
    expect(css).toContain("content: '+'")
  })

  it('收起是独立的 54px 细条，不写盘、不受 30% 下限约束', () => {
    expect(app).toContain('SHEET_COLLAPSED_PX = 54')
    expect(app).toContain('heightBeforeMinimize')
    expect(app).not.toMatch(/function minimizeSheet\(\)[\s\S]{0,300}?saveSheetH\(\)/)
    expect(app).toMatch(/function onViewportResize\(\)[\s\S]{0,200}?!sheetMinimized\.value/)
    expect(css).toContain('.detail.is-minimized .detail__body')
    expect(css).toContain('.detail.is-minimized .detail__meta')
  })

  it('黄灯可往复，绿灯从收起态直接最大化，点细条也能展开', () => {
    expect(app).toContain('function restoreSheet()')
    expect(app).toMatch(/function minimizeSheet\(\)[\s\S]{0,250}?sheetMinimized\.value\)\s*\{\s*restoreSheet\(\)/)
    expect(app).toMatch(/function maximizeSheet\(\)[\s\S]{0,250}?sheetMinimized\.value[\s\S]{0,200}?SHEET_MAX_RATIO/)
    expect(app).toContain('@click="onHeadClick"')
    expect(app).toContain('detail__restore')
    expect(app).toContain('is-minimized')
  })
})

describe('T-45 · 记事本回到「左源码 / 右预览」分栏', () => {
  const editor = read('src/ui/MarkdownEditor.vue')

  it('三档视图：分栏 / 源码 / 预览，默认分栏', () => {
    expect(app).toContain('>分栏</button>')
    expect(app).toContain('>源码</button>')
    expect(app).toContain('>预览</button>')
    expect(app).toContain("type DocView = 'split' | 'source' | 'preview'")
    expect(app).toContain("const docView = ref<DocView>('split')")
    // v5.1 存在 localStorage 里的 wys 要能平滑回到分栏
    expect(app).toContain("if (saved === 'wys') return 'split'")
    expect(app).toContain("if (saved === 'edit') return 'source'")
    expect(app).toContain("const DOC_VIEW_KEY = 'sticky.doc.view'")
  })

  it('左边写源码，右边看效果，两栏共用同一份 Markdown', () => {
    expect(app).toContain('<MarkdownEditor')
    expect(app).toContain(':view="docView"')
    expect(app).toContain(':model-value="docDraft.content"')
    expect(app).toContain('function onEditorInput')
    expect(editor).toContain('class="mdx__input"')
    expect(editor).toContain('class="md md-doc"')
    // 切换视图只改显隐，文本域不重建，原生撤销与光标位置都还在
    expect(editor).toContain('v-show="view !== \'preview\'"')
    expect(editor).toContain('v-show="view !== \'source\'"')
  })

  it('预览只吃 renderMarkdown 的输出，全仓无 v-html', () => {
    expect(editor).toContain("import { renderMarkdown } from '../core/markdown'")
    expect(editor).toContain('body.innerHTML = renderMarkdown(props.modelValue)')
    for (const source of [app, editor]) expect(source).not.toContain('v-html')
  })

  it('源码是唯一真源，撤销 / 输入法 / 选区交回浏览器原生实现', () => {
    expect(editor).not.toContain('contenteditable')
    expect(editor).not.toContain('editorHistory')
    expect(editor).toContain("emit('update:modelValue'")
    // 不接管粘贴：外部 HTML 本来就进不了文本域
    expect(editor).not.toContain('onPaste')
    expect(existsSync(resolve(root, 'src/ui/editor'))).toBe(false)
  })

  it('两栏各自滚动：源码滚动带动预览，重排后按比例还原阅读位置', () => {
    expect(editor).toContain('function ratioOf')
    expect(editor).toContain('function syncFromSource')
    expect(editor).toContain('requestAnimationFrame')
    expect(css).toContain('.mdx__pane--preview')
    expect(css).toMatch(/\.mdx\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/)
    // 窄侧栏放不下两栏就上下叠放
    expect(css).toContain('@media (max-width: 899px)')
    // 所见即所得那一套样式退场
    expect(css).not.toContain('.wys')
    expect(css).not.toContain('.editor__body')
  })

  it('渲染结果沿用 .md 同一套排版，不引入第二套字号', () => {
    expect(css).toContain('.md pre code')
    expect(css).toContain('.md blockquote')
    expect(css).toContain('.md li.md-task')
    expect(css).toContain('.md-check--on')
    expect(css).toContain('.md th, .md td')
    expect(css).toContain('caret-color: var(--accent)')
  })
})
