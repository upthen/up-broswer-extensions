import type { KeyValueStore } from '../core/storage'

/** 唯一引用 chrome.* 的适配器。测试与非扩展环境由 MemoryStore 替代。 */
export class ChromeLocalStore implements KeyValueStore {
  private get area(): chrome.storage.LocalStorageArea {
    const available = typeof chrome !== 'undefined' && !!chrome.storage?.local
    if (!available) throw new Error('当前环境没有 chrome.storage.local')
    return chrome.storage.local
  }

  async get(key: string): Promise<unknown> {
    const result = await this.area.get(key)
    return result[key]
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.area.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key)
  }

  /** 启动时一次读回全部键；传 null 取整个存储区。 */
  async getAll(): Promise<Record<string, unknown>> {
    const result = await this.area.get(null)
    return result as Record<string, unknown>
  }

  /** 同一批写入：索引与条目一次性落盘，不会出现只写了一半的状态。 */
  async setMany(items: Record<string, unknown>): Promise<void> {
    await this.area.set(items)
  }

  async removeMany(keys: string[]): Promise<void> {
    await this.area.remove(keys)
  }
}
