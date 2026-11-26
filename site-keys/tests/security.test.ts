import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const coreDir = resolve(root, 'src/core')
const coreFiles = readdirSync(coreDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, source: readFileSync(resolve(coreDir, f), 'utf8') }))

const walk = (dir: string): { rel: string; source: string }[] => {
  const out: { rel: string; source: string }[] = []
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(rel))
    else if (/\.(ts|vue)$/.test(entry.name)) out.push({ rel, source: readFileSync(resolve(root, rel), 'utf8') })
  }
  return out
}

describe('T-31/T-35 · 分层与安全约束', () => {
  it('core 模块不得引用 chrome.* / DOM / 网络 / console / localStorage', () => {
    const offenders: string[] = []
    for (const file of coreFiles) {
      const s = file.source
      if (/\bchrome\./.test(s)) offenders.push(`${file.name}: chrome.*`)
      if (/\bdocument\./.test(s) || /\bwindow\./.test(s)) offenders.push(`${file.name}: DOM`)
      if (/\bfetch\(/.test(s) || /XMLHttpRequest/.test(s)) offenders.push(`${file.name}: network`)
      if (/\bconsole\./.test(s)) offenders.push(`${file.name}: console`)
      if (/localStorage/.test(s)) offenders.push(`${file.name}: localStorage`)
    }
    expect(offenders).toEqual([])
  })

  it('浏览器适配器单独放在 platform/ 且带 typeof chrome 保护', () => {
    const src = readFileSync(resolve(root, 'src/platform/chromeStores.ts'), 'utf8')
    expect(src).toContain('chrome.storage.local')
    expect(src).not.toContain('chrome.storage.session')
    expect(src).toContain("typeof chrome !== 'undefined'")
    expect(src).not.toMatch(/\bconsole\./)
    expect(src).not.toMatch(/\bfetch\(/)
  })

  it('src/ui 与 src/background 不写 console、不发网络、不注入脚本', () => {
    const offenders: string[] = []
    for (const { rel, source } of [...walk('src/ui'), ...walk('src/background')]) {
      if (/\bconsole\./.test(source)) offenders.push(`${rel}: console`)
      if (/\bfetch\(/.test(source) || /XMLHttpRequest/.test(source)) offenders.push(`${rel}: network`)
      if (/chrome\.scripting/.test(source)) offenders.push(`${rel}: scripting`)
    }
    expect(offenders).toEqual([])
  })

  it('UI 不含解锁 / 加密 / 域名归组 / 模块互通等旧概念', () => {
    const ui = [...walk('src/ui'), ...walk('src/background')]
      .map((f) => f.source)
      .join('\n')
    for (const word of [
      '主密码', '解锁', '立即锁定', 'PBKDF2', 'AES-GCM', 'scope', 'pathPrefix',
      'useVault', 'buildImportPreview', 'parseBackup', '转为文档', 'noteToDoc',
      '导出备份', 'exportBackup', 'marked', 'DOMPurify',
    ]) {
      expect(ui).not.toContain(word)
    }
  })

  it('T-41：右键保存经由 core 纯逻辑，后台不注入脚本、不读页面 DOM、不发消息给网页', () => {
    const bg = read('src/background/index.ts')
    const core = read('src/core/selection.ts')
    expect(bg).toContain('createSelectionSaver')
    expect(bg).not.toMatch(/chrome\.tabs\.sendMessage|window\.getSelection|document\.|chrome\.scripting/)
    expect(core).not.toMatch(/\bchrome\.|\bdocument\.|\bwindow\.|\bconsole\.|\bfetch\(|localStorage/)
  })

  it('v5.1：txt 仍是唯一文件入口；Markdown 只经本地白名单渲染，不允许导出 / 下载', () => {
    const ui = [...walk('src/ui'), ...walk('src/background')]
      .map((f) => f.source)
      .join('\n')
    expect(ui).toContain('type="file"')
    expect(ui).toContain('导入 txt')
    expect(ui).toContain('planImport')
    // v5.2 起没有 v-html：预览只用 renderMarkdown 的转义结果填 innerHTML，
    // 源码是纯文本域，两个方向都不产生裸 HTML 拼接
    expect(ui).not.toContain('v-html')
    expect(ui).toContain("from '../core/markdown'")
    expect(ui).toContain('renderMarkdown(props.modelValue)')
    expect(ui).not.toContain('contenteditable')
    for (const word of ['导出', 'download', 'createObjectURL', 'marked', 'markdown-it']) {
      expect(ui).not.toContain(word)
    }
  })
})

describe('T-35/T-36 · 重做后的文件边界', () => {
  it('旧账号库模型与 v3 单模块文件全部不存在', () => {
    const gone = [
      'src/core/scope.ts', 'src/core/psl.ts', 'src/core/grouping.ts',
      'src/core/matching.ts', 'src/core/csv.ts', 'src/core/backup.ts',
      'src/core/vault.ts', 'src/core/crypto.ts', 'src/core/session.ts',
      'src/core/notes.ts',
      'src/ui/SidePanel.vue', 'src/ui/Manage.vue',
      'src/ui/components/AuthGate.vue',
      'src/ui/composables/useVault.ts', 'src/ui/composables/useNotes.ts',
      'manage.html', 'import/accounts-seed.json',
    ]
    for (const p of gone) expect(existsSync(resolve(root, p))).toBe(false)
  })

  it('v4 双模块文件齐全', () => {
    for (const p of [
      'src/core/types.ts', 'src/core/workspace.ts', 'src/core/storage.ts', 'src/core/index.ts',
      'src/ui/composables/useWorkspace.ts', 'src/ui/App.vue', 'src/ui/styles/base.css',
      'design/mockup.html',
    ]) {
      expect(existsSync(resolve(root, p))).toBe(true)
    }
  })

  it('新界面是单一 App.vue，两个入口都挂载它', () => {
    expect(existsSync(resolve(root, 'src/ui/App.vue'))).toBe(true)
    expect(read('src/ui/sidepanel.ts')).toContain('App.vue')
    expect(read('src/ui/page.ts')).toContain('App.vue')
    expect(read('sidepanel.html')).toContain('/src/ui/sidepanel.ts')
    expect(read('page.html')).toContain('/src/ui/page.ts')
  })
})
