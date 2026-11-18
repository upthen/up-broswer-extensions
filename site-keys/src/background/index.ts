/** 后台只做侧栏行为、快捷键与右键菜单；保存走 core 纯逻辑，不碰页面 DOM、不发网络请求。 */
import { createSelectionSaver } from '../core/selection'
import { ChromeLocalStore } from '../platform/chromeStores'

const MENU_ID = 'sticky-save-selection'
const saver = createSelectionSaver({
  store: new ChromeLocalStore(),
  now: () => Date.now(),
  makeId: () => crypto.randomUUID(),
})

chrome.runtime.onInstalled.addListener(() => {
  const behavior = chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
  behavior?.catch(() => {})
  // 菜单项属于扩展而不是 worker，注册一次即可持久；更新时先清再建，避免重复 id。
  void chrome.contextMenus.removeAll()
    .then(() => chrome.contextMenus.create({
      id: MENU_ID,
      title: '存为便签',
      contexts: ['selection'],
    }))
    .catch(() => {})
})

// 选中文本由浏览器在右键时直接交给回调，无需注入脚本或页面访问权限。
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return
  void saver.save(info.selectionText ?? '').catch(() => {})
})

chrome.commands?.onCommand.addListener(async (command, tab) => {
  if (command !== 'open-sticky') return
  try {
    await chrome.sidePanel.open({
      windowId: tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
    })
  } catch {
    // 侧栏不可用时静默，不在后台页写任何输出
  }
})
