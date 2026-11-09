// 「返回卡片墙」的共同逻辑：找出已打开的主面板并聚焦；找不到就直接新开一个。
//
// 为什么不走 service worker（v1.2.1 修正）：
//   MV3 的 service worker 可被随时回收。若把这段异步工作放在 onMessage 监听器里
//   而不保持消息通道，worker 可能在 ping / tabs.update 途中被终止，点击就「什么都没发生」。
//   详情页是常驻可见的标签页，由它自己执行不会因为 worker 休眠而丢失。
//
// 不声明 tabs 权限：靠扩展上下文间的 panel-ping 握手拿到主面板自己上报的 tabId，
// 再用不需要权限的 tabs.update / windows.update 聚焦。

const PANEL = 'index.html';

// api 可注入，便于在 Node 里用假 chrome 对象做单元测试。
export async function focusPanel(api = chrome, timeoutMs = 800) {
  let pong = null;
  let timer = 0;
  try {
    pong = await Promise.race([
      api.runtime.sendMessage({ type: 'panel-ping' }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('panel-ping timeout')), timeoutMs);
      }),
    ]);
  } catch (err) {
    // 面板未打开、被冻结或没有回应 —— 落到下面的新建分支
    console.info('[panel-focus] no panel response:', err && err.message);
  } finally {
    clearTimeout(timer);
  }

  if (pong && pong.tabId != null) {
    try {
      await api.tabs.update(pong.tabId, { active: true });
      if (pong.windowId != null) {
        try {
          await api.windows.update(pong.windowId, { focused: true });
        } catch (err) {
          // 窗口已关闭或不可聚焦时，标签本身已经激活，不算失败
        }
      }
      return 'focused';
    } catch (err) {
      // tabId 已失效（面板刚被关掉），落到新建分支
      console.info('[panel-focus] focus failed, opening a new panel:', err && err.message);
    }
  }

  try {
    await api.tabs.create({ url: api.runtime.getURL(PANEL) });
    return 'created';
  } catch (err) {
    console.warn('[panel-focus] failed to open panel:', err);
    return 'failed';
  }
}
