import { describe, expect, it } from 'vitest'
import { INITIAL_NOTES } from '../src/seed/initialNotes'
import { extractPassword } from '../src/core/workspace'

/** 刻意不在此文件重复粘贴任何密码字面量，只校验结构与完整性。 */
const EXPECTED: { title: string; address: string }[] = [
  { title: 'pyxis', address: 'https://10.6.125.231:30443' },
  { title: 'apisix', address: 'http://10.6.125.231:30453' },
  { title: 'canal', address: 'http://10.6.125.231:38089' },
  { title: 'laf', address: 'http://10.6.125.231.nip.io:14080' },
  { title: 'Alert', address: 'http://10.6.125.230:19090' },
  { title: 'Monitor', address: 'http://10.6.125.230:13000/grafana' },
  { title: 'Log server（victorialogs）', address: 'http://10.6.125.230:9428/select/vmui/' },
  { title: 'rocketMq', address: 'http://10.6.125.230:18080/#/topic' },
]

describe('T-22 · 初始便签数据', () => {
  it('8 张便签，标题与顺序和服务清单一致', () => {
    expect(INITIAL_NOTES).toHaveLength(8)
    expect(INITIAL_NOTES.map((n) => n.title)).toEqual(EXPECTED.map((e) => e.title))
    expect(new Set(INITIAL_NOTES.map((n) => n.title)).size).toBe(8)
  })

  it('每张都写明完整地址、账号与可复制的密码行', () => {
    INITIAL_NOTES.forEach((note, i) => {
      expect(note.content).toContain(`地址：${EXPECTED[i]!.address}`)
      expect(note.content).toContain('账号：admin')
      expect(note.content).toMatch(/密码：\S+/)
      const password = extractPassword(note.content)
      expect(password).not.toBeNull()
      expect(password!.length).toBeGreaterThan(0)
    })
  })

  it('Log server 带参考文档备注，Monitor 标明路径用途', () => {
    expect(INITIAL_NOTES[6]!.content).toContain('victorialogs使用手册')
    expect(INITIAL_NOTES[5]!.content).toContain('/grafana')
  })

  it('内容是多行自由文本，不含任何结构化字段对象', () => {
    for (const note of INITIAL_NOTES) {
      expect(typeof note).toBe('object')
      expect(Object.keys(note).sort()).toEqual(['content', 'title'])
      expect(note.content.split('\n').length).toBeGreaterThanOrEqual(3)
    }
  })
})
