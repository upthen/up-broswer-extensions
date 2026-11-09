/**
 * 扩展可能从两个位置被加载：
 *  - dist/      （产物目录，页面路径为 index.html）
 *  - 项目根目录  （转发版 manifest，页面路径为 dist/index.html）
 * 所以页面地址不能写死，统一按 popup 入口所在目录推导。
 */
export function pageUrl(file: string): string {
  const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL
  if (!hasChrome) return file

  const popup = (chrome.runtime.getManifest().action as { default_popup?: string } | undefined)?.default_popup
  const dir = popup && popup.lastIndexOf('/') >= 0 ? popup.slice(0, popup.lastIndexOf('/') + 1) : ''
  return chrome.runtime.getURL(dir + file)
}
