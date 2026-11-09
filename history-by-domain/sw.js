// MV3 service worker：只处理入口与面板复用。
// 不缓存数据、不设定时器、不注册 onVisited —— 被浏览器随时回收是设计前提。
// 面板页自己持有全部状态并直接调 chrome.history，不依赖本文件存活。

const PANEL = 'index.html';

async function openOrFocusPanel(q) {
  try {
    const pong = await Promise.race([
      chrome.runtime.sendMessage({ type: 'panel-ping' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 300)),
    ]);
    if (pong && pong.tabId) {
      await chrome.tabs.update(pong.tabId, { active: true });
      if (pong.windowId) {
        try {
          await chrome.windows.update(pong.windowId, { focused: true });
        } catch (err) {
          // 聚焦窗口失败不影响激活标签本身
        }
      }
      if (q) chrome.runtime.sendMessage({ type: 'panel-query', q }).catch(() => {});
      return;
    }
  } catch (err) {
    // 面板未打开或超时，走新建
  }
  const url = chrome.runtime.getURL(PANEL) + (q ? `?q=${encodeURIComponent(q)}` : '');
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => { openOrFocusPanel(); });
chrome.omnibox.onInputEntered.addListener((text) => { openOrFocusPanel(String(text || '').trim()); });

// v1.2.1：这里刻意不注册 chrome.runtime.onMessage。
// 详情页的「← 返回卡片墙」改由 detail.js 直接发 panel-ping 并自行聚焦，
// 不再经过 service worker —— MV3 worker 可能在异步聚焦途中被回收，导致点击无反应。
// 同时，本文件不作为广播接收方，panel-ping 不会被一个「不回包的端口」提前终结。
