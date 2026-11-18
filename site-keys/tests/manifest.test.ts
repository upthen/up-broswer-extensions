import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'))
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('T-25 · MV3 清单与权限审计', () => {
  it('manifest_version / 最低版本 / 名称', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.minimum_chrome_version).toBe('114')
    expect(manifest.name).toBe('便签本 · Sticky')
  })

  it('permissions 恰为四项（右键菜单 + 侧栏 + 存储 + 解除 10 MB 上限），host_permissions 为空', () => {
    expect([...manifest.permissions].sort()).toEqual([
      'contextMenus', 'sidePanel', 'storage', 'unlimitedStorage',
    ])
    expect(manifest.host_permissions).toEqual([])
  })

  it('不再需要 tabs / clipboardWrite / scripting / history / downloads', () => {
    for (const p of ['tabs', 'clipboardWrite', 'scripting', 'history', 'downloads']) {
      expect(manifest.permissions).not.toContain(p)
    }
    expect(manifest.content_scripts).toBeUndefined()
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>')
  })

  it('侧栏、全屏页与 service worker 入口齐全', () => {
    expect(manifest.side_panel.default_path).toBe('sidepanel.html')
    expect(manifest.background.service_worker).toBe('background.js')
    expect(manifest.background.type).toBe('module')
    expect(manifest.commands['open-sticky'].suggested_key.default).toBe('Alt+Shift+S')
  })

  it('四个 PNG 图标已生成', () => {
    for (const size of [16, 32, 48, 128]) {
      expect(existsSync(resolve(root, `public/icons/icon${size}.png`))).toBe(true)
    }
  })

  it('全屏页构建输入另有其名 page.html', () => {
    expect(existsSync(resolve(root, 'page.html'))).toBe(true)
    expect(read('vite.config.ts')).toContain('page.html')
  })

  it('service worker 只做侧栏 / 快捷键 / 右键保存三件事，不碰网络与页面 DOM', () => {
    const src = read('src/background/index.ts')
    expect(src).toContain('setPanelBehavior')
    expect(src).toContain('onCommand')
    expect(src).toContain('open-sticky')
    expect(src).toContain('contextMenus')
    expect(src).toContain('createSelectionSaver')
    expect(src).not.toMatch(/console\./)
    expect(src).not.toMatch(/fetch\(/)
    expect(src).not.toContain('chrome.scripting')
    expect(src).not.toContain('executeScript')
    expect(src).not.toContain('storage.session')
    expect(src).not.toContain('content_scripts')
  })

  it('右键菜单只在 onInstalled 里创建一次，contexts 明确限定 selection', () => {
    const src = read('src/background/index.ts')
    expect(src.match(/contextMenus\.create\(/g)).toHaveLength(1)
    expect(src).toContain("contexts: ['selection']")
    expect(src).toContain("title: '存为便签'")
    expect(src).toContain('contextMenus.removeAll')
  })
})

/** 抽出 HTML 里所有指向 js/css 的本地资源引用。 */
function assetRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((r) => r.endsWith('.js') || r.endsWith('.css'))
}

// 回归：根目录 index.html 曾是带内联 <script> 的转发页，而 MV3 extension_pages 的 CSP
// 禁止内联脚本，导致「全屏打开」永远停在「正在打开便签本…若没有跳转，请点此」。
describe('T-27 · 全屏页在两种加载方式下都是可运行的真页面', () => {
  it('根 index.html 不是转发页：无内联脚本、无跳转文案、无 meta refresh', () => {
    const html = read('index.html')
    expect(html).not.toContain('正在打开便签本')
    expect(html).not.toContain('若没有跳转')
    expect(html).not.toContain('location.replace')
    expect(html).not.toMatch(/http-equiv=["']?refresh/i)
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      expect(tag).toMatch(/\bsrc=/)
      expect(tag).toMatch(/type="module"/)
    }
  })

  it('根 index.html 就是真应用页：挂载点 + 资源全部指向 dist/assets 且文件存在', () => {
    const html = read('index.html')
    expect(html).toContain('<div id="app"></div>')
    const refs = assetRefs(html)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(r.startsWith('dist/assets/')).toBe(true)
      expect(existsSync(resolve(root, r))).toBe(true)
    }
  })

  it('dist/index.html 与根页面是同一份产物，仅资源前缀不同', () => {
    const distHtml = read('dist/index.html')
    const rootHtml = read('index.html')
    expect(distHtml).toContain('<div id="app"></div>')
    for (const r of assetRefs(distHtml)) {
      expect(r.startsWith('./assets/')).toBe(true)
      expect(existsSync(resolve(root, 'dist', r.replace(/^\.\//, '')))).toBe(true)
    }
    expect(rootHtml.replaceAll('dist/assets/', './assets/')).toBe(distHtml)
  })

  it('全屏入口用 chrome.tabs.create 打开 getURL(index.html)', () => {
    const src = read('src/ui/App.vue')
    expect(src).toContain("getURL('index.html')")
    expect(src).toMatch(/chrome\.tabs\??\.create/)
  })
})
