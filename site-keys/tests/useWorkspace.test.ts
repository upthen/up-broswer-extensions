import { describe, expect, it } from 'vitest'
import { createWorkspaceController } from '../src/ui/composables/useWorkspace'
import type { WorkspaceDeps } from '../src/ui/composables/useWorkspace'
import { LEGACY_NOTES_KEY, META_KEY, MemoryStore } from '../src/core/storage'

const seed = [
  { title: 'A', content: '地址：http://a\n密码：pw-a' },
  { title: 'B', content: '地址：http://b\n密码：pw-b' },
]

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

describe('T-33 · 状态机与首次播种', () => {
  it('无库时播种 8 张初始便签、docs 为空、状态 ready、默认停在便签模块', async () => {
    const c = createWorkspaceController(deps())
    expect(c.state).toBe('loading')
    await c.init()
    expect(c.state).toBe('ready')
    expect(c.file?.version).toBe(2)
    expect(c.file?.notes.map((n) => n.title)).toEqual(['A', 'B'])
    expect(c.file?.docs).toEqual([])
    expect(c.activeModule).toBe('stickies')
    expect(c.activeDocId).toBeNull()
  })

  it('已有库原样加载，不重复播种、不覆盖', async () => {
    const local = new MemoryStore()
    const first = createWorkspaceController(deps({ local }))
    await first.init()
    const id = await first.createNote()
    await first.updateNote(id, { title: '我写的', content: '随便填' })

    const second = createWorkspaceController(deps({ local }))
    await second.init()
    expect(second.file?.notes).toHaveLength(3)
    expect(second.file?.notes.some((n) => n.title === '我写的')).toBe(true)
  })

  it('清空便签后重启不会补回初始便签，且文档不受影响', async () => {
    const local = new MemoryStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    await c.createDoc()
    await c.clearNotes()

    const again = createWorkspaceController(deps({ local }))
    await again.init()
    expect(again.file?.notes).toEqual([])
    expect(again.file?.docs).toHaveLength(1)
    expect(await local.get(META_KEY)).toMatchObject({ version: 3, notes: [] })
  })

  it('v1 旧库自动迁移，便签内容保留、文档为空', async () => {
    const local = new MemoryStore()
    await local.set(LEGACY_NOTES_KEY, {
      version: 1,
      notes: [{ id: 'old', title: '旧便签', content: '密码：keep-me', createdAt: 5, updatedAt: 6 }],
    })
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    expect(c.file?.notes[0]!.title).toBe('旧便签')
    expect(c.file?.docs).toEqual([])
    expect(c.readPassword('old')).toBe('keep-me')
    expect(await local.get(LEGACY_NOTES_KEY)).toBeUndefined()
  })
})

describe('T-33 · 模块切换与便签 CRUD', () => {
  it('setModule 在两个模块间切换，默认便签', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    expect(c.activeModule).toBe('stickies')
    c.setModule('notebook')
    expect(c.activeModule).toBe('notebook')
    c.setModule('stickies')
    expect(c.activeModule).toBe('stickies')
  })

  it('createNote 插到最前、返回 id、标题可兜底；update / remove 立即持久化', async () => {
    const local = new MemoryStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    const id = await c.createNote()
    expect(id).toMatch(/^id-/)
    expect(c.file?.notes[0]!.id).toBe(id)
    expect(c.file?.notes[0]!.title).toBe('未命名便签')

    await c.updateNote(id, { title: '改名', content: '密码：new-pw' })
    await c.removeNote(c.file!.notes[1]!.id)

    const reopened = createWorkspaceController(deps({ local }))
    await reopened.init()
    expect(reopened.file?.notes[0]!.title).toBe('改名')
    expect(reopened.readPassword(id)).toBe('new-pw')
  })

  it('readPassword 只做行识别，无匹配返回 null', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    expect(c.readPassword(c.file!.notes[0]!.id)).toBe('pw-a')
    const blank = await c.createNote()
    expect(c.readPassword(blank)).toBeNull()
    expect(c.readPassword('不存在的 id')).toBeNull()
  })
})

describe('T-33 · 记事本文档 CRUD 与当前项', () => {
  it('createDoc 自动选中并插到最前；updateDoc 立即持久化', async () => {
    const local = new MemoryStore()
    const c = createWorkspaceController(deps({ local }))
    await c.init()
    const id = await c.createDoc()
    expect(c.activeDocId).toBe(id)
    expect(c.file?.docs[0]!.title).toBe('未命名文档')

    await c.updateDoc(id, { title: '发布前检查', content: '一、环境信息\n地址：http://x' })
    const reopened = createWorkspaceController(deps({ local }))
    await reopened.init()
    expect(reopened.file?.docs[0]!.title).toBe('发布前检查')
    expect(reopened.activeDocId).toBe(id)
  })

  it('setActiveDoc 切换当前文档', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    const a = await c.createDoc()
    const b = await c.createDoc()
    expect(c.activeDocId).toBe(b)
    c.setActiveDoc(a)
    expect(c.activeDocId).toBe(a)
    expect(c.file?.docs.map((d) => d.id)).toEqual([b, a])
  })

  it('删除当前文档自动选中剩余第一篇；删光置 null', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    const a = await c.createDoc()
    const b = await c.createDoc()
    expect(c.activeDocId).toBe(b)

    await c.removeDoc(b)
    expect(c.activeDocId).toBe(a)
    await c.removeDoc(a)
    expect(c.activeDocId).toBeNull()
    expect(c.file?.docs).toEqual([])
  })

  it('删除非当前文档不改变选中项；文档操作不影响便签', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    const a = await c.createDoc()
    const b = await c.createDoc()
    const notesBefore = c.file?.notes
    await c.removeDoc(a)
    expect(c.activeDocId).toBe(b)
    expect(c.file?.notes).toEqual(notesBefore)
  })

  it('便签与文档数据互不相通：没有转换为文档之类的入口', async () => {
    const c = createWorkspaceController(deps())
    await c.init()
    const methods = Object.keys(c).sort()
    for (const forbidden of ['convertToDoc', 'noteToDoc', 'moveToNotebook', 'setup', 'unlock', 'lock']) {
      expect(methods).not.toContain(forbidden)
    }
  })
})
