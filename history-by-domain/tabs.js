// 标签页管理：纯逻辑层。零 chrome.* 依赖，可在 node 下直接测试。
// v1.5.0 起按**主机名**（host）成卡，不再按 eTLD+1 合并子域：同一家公司的
// 不同应用常挂在不同子域上（naui./ai-gw./www.），合并成一张卡反而更难用。
// 历史侧仍按 eTLD+1，故这里刻意不复用 domain.js 的 regDomain 作为卡片 key。

import { normalizeItem, LOCAL_BUCKET } from './domain.js';
import { splitWords } from './search.js';

export { LOCAL_BUCKET };

export const CLOSE_MODE = Object.freeze({ GROUP: 'group', OTHERS: 'others', SINGLE: 'single' });

export function groupLabel(key) {
  return key === LOCAL_BUCKET ? '本地 / 其他' : key;
}

// 卡片 key：非特殊页面一律取完整主机名；特殊桶固定 __local__。
// 成卡、组级关闭、行级关闭其他三处必须共用这一个口径，否则「全部关闭」
// 会跨到同主域的其他子域上去。
export function groupKeyOf(item) {
  if (!item || item.isSpecial) return LOCAL_BUCKET;
  return item.host || item.regDomain || LOCAL_BUCKET;
}

// 事件委托里按钮的 key 可能挂在按钮上，也可能只挂在卡片上。
// 兜底取卡片 key，避免某个按钮漏挂 dataset.key 时点击完全没反应（v1.5.0 缺陷）。
export function pickActionKey(buttonKey, cardKey) {
  return buttonKey || cardKey || '';
}

// 面板自身与详情页都属于扩展地址，必须剔除，否则批量关闭可能把 UI 关掉。
export function isSelfTab(url, extensionOrigin) {
  if (!extensionOrigin || !url) return false;
  return String(url).startsWith(extensionOrigin);
}

// Chrome Tab[] -> 行模型。按原始标签顺序计算重复标记（第一个保留，后续副本标重复）。
export function normalizeTabs(rawTabs, extensionOrigin) {
  const items = [];
  for (const t of rawTabs || []) {
    if (!t || !t.url || isSelfTab(t.url, extensionOrigin)) continue;
    const p = normalizeItem({ url: t.url, title: t.title || '' });
    if (!p) continue;
    // 标签页侧口径：内网单标签主机（如 uih-office）归特殊桶。
    // 不修改 domain.js——历史侧刻意把它当成独立域名，改动会回归。
    if (!p.isSpecial && p.host && !p.host.includes('.')) {
      p.regDomain = LOCAL_BUCKET;
      p.isSpecial = true;
    }
    items.push({
      ...p,
      tabId: t.id,
      windowId: Number(t.windowId) || 0,
      index: Number(t.index) || 0,
      pinned: !!t.pinned,
      active: !!t.active,
      rawUrl: t.url,
      isDuplicate: false,
    });
  }
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.rawUrl)) item.isDuplicate = true;
    else seen.add(item.rawUrl);
  }
  return items;
}

export function filterTabs(items, query) {
  const words = splitWords(query);
  if (!words.length) return [...items];
  return items.filter((item) => {
    const hay = `${item.title} ${item.url} ${item.host} ${item.regDomain} ${groupLabel(item.regDomain)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const byTabOrder = (a, b) => (a.windowId - b.windowId) || (a.index - b.index) || (a.tabId - b.tabId);

// 按主机名聚合成卡片；特殊桶固定末位，其余按标签数降序、同数按主机名排序。
export function buildGroups(items, query) {
  const map = new Map();
  for (const item of filterTabs(items, query)) {
    const key = groupKeyOf(item);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: groupLabel(key),
        isSpecial: key === LOCAL_BUCKET,
        tabs: [],
      };
      map.set(group.key, group);
    }
    group.tabs.push(item);
  }
  const groups = [...map.values()];
  for (const group of groups) {
    group.tabs.sort(byTabOrder);
    group.count = group.tabs.length;
  }
  groups.sort((a, b) => {
    if (a.isSpecial !== b.isSpecial) return a.isSpecial ? 1 : -1;
    if (a.count !== b.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return groups;
}

// 计算一条写路径真正要关闭的标签 id。只读、无副作用，可在确认前反复调用。
// group / others 模式按**主机名**圈定范围，跳过固定标签（single 是用户逐条点的，不跳过）。
export function computeRemoveTargets(items, options) {
  const { mode, key, tabId, skipPinned = true } = options || {};
  const empty = { ids: [], count: 0, key, label: groupLabel(key), hosts: [], windows: [], skippedPinned: 0, keep: null };

  if (mode === 'group') {
    if (!key || key === LOCAL_BUCKET) return empty; // 特殊桶不给整组关闭
    const base = items.filter((i) => groupKeyOf(i) === key);
    return summarize(base, skipPinned, key, null);
  }
  if (mode === 'others') {
    const keep = items.find((i) => i.tabId === tabId);
    const keepKey = keep ? groupKeyOf(keep) : '';
    if (!keep || !keepKey || keepKey === LOCAL_BUCKET) return empty;
    const base = items.filter((i) => groupKeyOf(i) === keepKey && i.tabId !== tabId);
    return summarize(base, skipPinned, keepKey, keep);
  }
  if (mode === 'single') {
    const one = items.find((i) => i.tabId === tabId);
    if (!one) return empty;
    return summarize([one], false, groupKeyOf(one), null);
  }
  return empty;
}

function summarize(base, skipPinned, key, keep) {
  const targets = skipPinned ? base.filter((i) => !i.pinned) : [...base];
  const hosts = new Map();
  const windows = new Map();
  for (const i of targets) {
    const host = i.host || groupLabel(i.regDomain);
    hosts.set(host, (hosts.get(host) || 0) + 1);
    windows.set(i.windowId, (windows.get(i.windowId) || 0) + 1);
  }
  return {
    ids: targets.map((i) => i.tabId),
    count: targets.length,
    key,
    label: groupLabel(key),
    hosts: [...hosts].map(([host, count]) => ({ host, count }))
      .sort((a, b) => (b.count - a.count) || a.host.localeCompare(b.host)),
    windows: [...windows].map(([windowId, count]) => ({ windowId, count }))
      .sort((a, b) => a.windowId - b.windowId),
    skippedPinned: base.length - targets.length,
    keep: keep ? { tabId: keep.tabId, title: keep.title || keep.url } : null,
  };
}

export function confirmText(target, mode) {
  // 卡内只剩一个主机名，明细不再需要；跨窗口时补窗口范围，让爆炸半径看得见。
  const winText = target.windows && target.windows.length > 1
    ? `（${target.windows.map((w) => `窗口 ${w.windowId} ×${w.count}`).join('、')}）`
    : '';
  const skipped = target.skippedPinned ? `已固定 ${target.skippedPinned} 个不会关闭。` : '';
  const tail = `${skipped}可随时用 Ctrl+Shift+T 恢复。`;
  if (mode === 'others') {
    return `保留「${target.keep ? target.keep.title : '当前标签页'}」，关闭 ${target.label} 的其余 ${target.count} 个标签页${winText}。${tail}`;
  }
  return `将关闭 ${target.label} 的 ${target.count} 个标签页${winText}。${tail}`;
}
