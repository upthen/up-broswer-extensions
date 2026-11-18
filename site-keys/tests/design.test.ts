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
      '.editor', '.editor__page', '.editor__title', '.editor__body',
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
    const rule = css.match(/\.editor__body\s*\{([^}]*)\}/)?.[1] ?? ''
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
      'editor__page', 'editor__title', 'editor__body',
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
