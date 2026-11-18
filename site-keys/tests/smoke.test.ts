import { describe, expect, it } from 'vitest'
import { WORKSPACE_VERSION, createEmptyWorkspace } from '@/core'

describe('T-30 · 工程冒烟', () => {
  it('core barrel 可解析，数据格式版本为 2', () => {
    expect(WORKSPACE_VERSION).toBe(2)
    expect(createEmptyWorkspace()).toEqual({ version: 2, notes: [], docs: [] })
  })
})
