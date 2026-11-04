const chromeStore = typeof chrome !== 'undefined' && !!chrome.storage?.local

/** chrome.storage.local 优先；在普通浏览器里跑 dev/preview 时自动退回 localStorage */
export async function loadValue<T>(key: string, fallback: T): Promise<T> {
  try {
    if (chromeStore) {
      const result = await chrome.storage.local.get(key)
      const value = result?.[key]
      return (value as T) ?? fallback
    }
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export async function saveValue<T>(key: string, value: T): Promise<void> {
  try {
    if (chromeStore) {
      await chrome.storage.local.set({ [key]: value })
      return
    }
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不下就算了，不影响主流程 */
  }
}

export async function removeValue(key: string): Promise<void> {
  try {
    if (chromeStore) {
      await chrome.storage.local.remove(key)
      return
    }
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
