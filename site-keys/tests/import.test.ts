import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  SKIP_REASON,
  TXT_ACCEPT,
  decodeTextFile,
  isTxtFile,
  planImport,
  titleFromFileName,
} from '../src/core/textFile'
import type { ImportSource } from '../src/core/textFile'
import { createWorkspaceController } from '../src/ui/composables/useWorkspace'
import type { WorkspaceDeps } from '../src/ui/composables/useWorkspace'
import { MemoryStore, META_KEY } from '../src/core/storage'

const root = resolve(process.cwd())
const encoder = new TextEncoder()
const utf8 = (text: string): Uint8Array => encoder.encode(text)
const source = (name: string, bytes: Uint8Array, size = bytes.length): ImportSource => ({ name, size, bytes })

/** 计数写入次数：批量导入必须只落盘一次（v3 起写入统一走 setMany）。 */
class CountingStore extends MemoryStore {
  writes = 0
  async setMany(items: Record<string, unknown>): Promise<void> {
    this.writes++
    await super.setMany(items)
  }
  async set(key: string, value: unknown): Promise<void> {
    this.writes++
    await super.set(key, value)
  }
}

describe('T-38 · txt 解码：编码识别与 BOM', () => {
  it('UTF-8 无 BOM：中文与换行原样保留', () => {
    const r = decodeTextFile(utf8('地址：http://x\n账号：admin\n密码：pw'))
    expect(r.encoding).toBe('utf-8')
    expect(r.text).toBe('地址：http://x\n账号：admin\n密码：pw')
  })

  it('UTF-8 BOM 被剥掉，不留在正文首字符', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('第一行')])
    const r = decodeTextFile(bytes)
    expect(r.encoding).toBe('utf-8')
    expect(r.text).toBe('第一行')
    expect(r.text.charCodeAt(0)).toBe('第'.charCodeAt(0))
  })

  it('GB18030 / GBK 中文不会变成乱码（Windows 记事本 ANSI 场景）', () => {
    // 「中文测试」的 GBK 字节
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])
    const r = decodeTextFile(bytes)
    expect(r.encoding).toBe('gb18030')
    expect(r.text).toBe('中文测试')
  })

  it('UTF-16LE BOM（Windows「Unicode」另存为）', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
    const r = decodeTextFile(bytes)
    expect(r.encoding).toBe('utf-16le')
    expect(r.text).toBe('AB')
  })

  it('UTF-16BE BOM', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42])
    const r = decodeTextFile(bytes)
    expect(r.encoding).toBe('utf-16be')
    expect(r.text).toBe('AB')
  })

  it('无 BOM 的 UTF-16LE 靠 NUL 比例兜底识别', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00])
    expect(decodeTextFile(bytes).text).toBe('ABC')
  })

  it('纯 ASCII 一律按 UTF-8，不误判成 GB18030', () => {
    expect(decodeTextFile(utf8('hello world')).encoding).toBe('utf-8')
  })

  it('空文件返回空字符串，不抛异常', () => {
    expect(decodeTextFile(new Uint8Array(0)).text).toBe('')
  })
})

describe('T-38 · 文件名 → 文档标题', () => {
  it('去掉 .txt 后缀（大小写不敏感）', () => {
    expect(titleFromFileName('发布清单.txt')).toBe('发布清单')
    expect(titleFromFileName('README.TXT')).toBe('README')
  })

  it('只保留文件名，Windows 与 Unix 路径都不带进标题', () => {
    expect(titleFromFileName('C:\\docs\\部署说明.txt')).toBe('部署说明')
    expect(titleFromFileName('/tmp/notes/a.txt')).toBe('a')
  })

  it('多重后缀只去掉最后一个', () => {
    expect(titleFromFileName('v1.2.notes.txt')).toBe('v1.2.notes')
  })

  it('空白名兜底为「未命名文档」，超长截断到 80 字', () => {
    expect(titleFromFileName('  .txt')).toBe('未命名文档')
    expect(titleFromFileName('x'.repeat(120) + '.txt')).toHaveLength(80)
  })

  it('isTxtFile 只认 .txt，且 accept 属性不含 md', () => {
    expect(isTxtFile('a.txt')).toBe(true)
    expect(isTxtFile('a.TXT')).toBe(true)
    expect(isTxtFile('a.md')).toBe(false)
    expect(TXT_ACCEPT).toBe('.txt,text/plain')
    expect(TXT_ACCEPT).not.toContain('md')
  })
})

describe('T-38 · 导入计划：一个 txt = 一篇新文档', () => {
  it('多个文件按选择顺序生成条目，标题取文件名、正文原样', () => {
    const plan = planImport([
      source('甲.txt', utf8('第一行\r\n第二行')),
      source('乙.txt', utf8('另一篇')),
    ])
    expect(plan.entries).toEqual([
      { title: '甲', content: '第一行\r\n第二行' },
      { title: '乙', content: '另一篇' },
    ])
    expect(plan.skipped).toEqual([])
  })

  it('CRLF 与空白原样保留，插件不改写正文', () => {
    const plan = planImport([source('a.txt', utf8('\n\n  末尾空格  \n'))])
    expect(plan.entries[0]!.content).toBe('\n\n  末尾空格  \n')
  })

  it('GBK 文件在计划里已正确解码', () => {
    const plan = planImport([source('中文.txt', new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))])
    expect(plan.entries[0]!.content).toBe('中文')
  })

  it('非 .txt 文件跳过且不阻塞其他文件', () => {
    const plan = planImport([source('a.md', utf8('# 标题')), source('b.txt', utf8('正文'))])
    expect(plan.entries).toHaveLength(1)
    expect(plan.skipped).toEqual([{ name: 'a.md', reason: SKIP_REASON.notTxt }])
  })

  it('单个文件超过 1 MB 跳过，不读进内存', () => {
    const plan = planImport([source('big.txt', new Uint8Array(0), MAX_IMPORT_BYTES + 1)])
    expect(plan.entries).toEqual([])
    expect(plan.skipped[0]!.reason).toBe(SKIP_REASON.tooLarge)
  })

  it('一次最多 20 个文件，多余的跳过', () => {
    const files = Array.from({ length: MAX_IMPORT_FILES + 2 }, (_, i) => source(`f${i}.txt`, utf8(`${i}`)))
    const plan = planImport(files)
    expect(plan.entries).toHaveLength(MAX_IMPORT_FILES)
    expect(plan.skipped).toHaveLength(2)
    expect(plan.skipped[0]!.reason).toBe(SKIP_REASON.tooMany)
  })

  it('空数组返回空计划，不产生任何条目', () => {
    expect(planImport([])).toEqual({ entries: [], skipped: [] })
  })
})

describe('T-38 · 状态机批量导入', () => {
  const seed = [{ title: '初始便签', content: '密码：keep' }]
  const deps = (over: Partial<WorkspaceDeps> = {}): WorkspaceDeps => {
    let seq = 0
    return {
      local: new MemoryStore(),
      now: () => 1000,
      seed,
      makeId: () => `id-${++seq}`,
      ...over,
    }
  }

  it('一次批量导入只写一次盘，按输入顺序排在文档列表最前', async () => {
    const local = new CountingStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    const before = local.writes

    const ids = await c.importDocs([
      { title: '甲', content: 'A' },
      { title: '乙', content: 'B' },
      { title: '丙', content: 'C' },
    ])

    expect(local.writes - before).toBe(1)
    expect(ids).toHaveLength(3)
    expect(c.file?.docs.map((d) => d.title)).toEqual(['甲', '乙', '丙'])
    expect(c.file?.docs[0]!.id).toBe(ids[0])
    expect(c.activeDocId).toBe(ids[0])
  })

  it('导入后重新加载仍存在，便签数据完全不受影响', async () => {
    const local = new MemoryStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    const notesBefore = c.file?.notes
    await c.importDocs([{ title: '导入的', content: '内容\n第二行' }])

    const again = createWorkspaceController(deps({ local }))
    await again.init()
    expect(again.file?.docs[0]!.title).toBe('导入的')
    expect(again.file?.docs[0]!.content).toBe('内容\n第二行')
    expect(again.file?.notes).toEqual(notesBefore)
    expect(await local.get(META_KEY)).toMatchObject({ version: 3 })
  })

  it('追加到已有文档列表前面，不覆盖正在写的文档', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    await c.createDoc()
    await c.updateDoc(c.activeDocId!, { title: '我写的', content: '别删' })
    await c.importDocs([{ title: '导入的', content: '新内容' }])
    expect(c.file?.docs.map((d) => d.title)).toEqual(['导入的', '我写的'])
    expect(c.file?.docs[1]!.content).toBe('别删')
  })

  it('空批次不写盘、不改变当前文档', async () => {
    const local = new CountingStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    const id = await c.createDoc()
    const before = local.writes
    expect(await c.importDocs([])).toEqual([])
    expect(local.writes).toBe(before)
    expect(c.activeDocId).toBe(id)
  })
})

describe('T-38 · UI / 权限守卫', () => {
  const app = readFileSync(resolve(root, 'src/ui/App.vue'), 'utf8')
  const css = readFileSync(resolve(root, 'src/ui/styles/base.css'), 'utf8')
  const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8')) as { permissions: string[]; host_permissions: string[] }

  it('记事本文件栏与窄栏下拉都有导入入口，且是隐藏的文件选择器', () => {
    expect(app).toContain('type="file"')
    expect(app).toContain('导入 txt')
    expect(app).toContain('multiple')
    expect(app).toContain('TXT_ACCEPT')
    expect(app.split('导入 txt')).toHaveLength(3) // 两处按钮 + 无第三处
    expect(app).toContain('hidden')
  })

  it('导入按钮沿用文件栏的次级样式，不引外部资源', () => {
    expect(app).toContain('file-new--sub')
    expect(css).toContain('.file-new--sub')
    expect(css).not.toMatch(/url\(\s*['"]?https?:/)
  })

  it('只收 txt、不渲染 md、不写日志、不做导出备份', () => {
    for (const word of ['v-html', 'marked', 'markdown-it', 'DOMPurify', '导出备份', 'download', 'console.']) {
      expect(app).not.toContain(word)
    }
  })

  it('导入不需要任何新权限', () => {
    expect(manifest.permissions).toEqual([
      'storage', 'sidePanel', 'unlimitedStorage', 'contextMenus',
    ])
    expect(manifest.host_permissions).toEqual([])
  })
})
