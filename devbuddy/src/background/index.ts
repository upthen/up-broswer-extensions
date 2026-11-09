import { pageUrl } from '../shared/urls'

chrome.runtime.onInstalled.addListener(() => {
  // 不劫持点击图标（图标保留 popup），侧边栏通过浏览器侧栏入口或快捷键打开
  const behavior = chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })
  behavior?.catch(() => {})
})

chrome.commands?.onCommand.addListener(async (command, tab) => {
  if (command === 'open-devtool') {
    await chrome.tabs.create({ url: pageUrl('index.html') })
    return
  }
  if (command === 'open-sidepanel') {
    try {
      const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT
      await chrome.sidePanel.open({ windowId })
    } catch {
      await chrome.tabs.create({ url: pageUrl('index.html') })
    }
  }
})
