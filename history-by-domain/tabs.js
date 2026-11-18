// 标签页管理：纯逻辑层。零 chrome.* 依赖，可在 node 下直接测试。
// 归组口径复用 domain.js，保证与历史/书签卡片墙的「域名」概念一致。

import { normalizeItem, LOCAL_BUCKET } from './domain.js';
import { splitWords } from './search.js';

export { LOCAL_BUCKET };

export function groupLabel(key) {
  return key === LOCAL_BUCKET ? '本地 / 其他' : key;
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

// 按 eTLD+1 聚合成卡片；特殊桶固定末位，其余按标签数降序、同数按域名排序。
export function buildGroups(items, query) {
  const map = new Map();
  for (const item of filterTabs(items, query)) {
    let group = map.get(item.regDomain);
    if (!group) {
      group = {
        key: item.regDomain,
        label: groupLabel(item.regDomain),
        isSpecial: item.regDomain === LOCAL_BUCKET,
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
// group / others 模式跳过固定标签；single 模式是用户逐条点的，不做跳过。
export function computeRemoveTargets(items, options) {
  const { mode, key, tabId, skipPinned = true } = options || {};
  const empty = { ids: [], count: 0, key, label: groupLabel(key), subdomains: [], skippedPinned: 0, keep: null };

  if (mode === 'group') {
    if (!key || key === LOCAL_BUCKET) return empty; // 特殊桶不给整组关闭
    const base = items.filter((i) => i.regDomain === key);
    return summarize(base, skipPinned, key, null);
  }
  if (mode === 'others') {
    const keep = items.find((i) => i.tabId === tabId);
    if (!keep || !keep.regDomain || keep.regDomain === LOCAL_BUCKET) return empty;
    const base = items.filter((i) => i.regDomain === keep.regDomain && i.tabId !== tabId);
    return summarize(base, skipPinned, keep.regDomain, keep);
  }
  if (mode === 'single') {
    const one = items.find((i) => i.tabId === tabId);
    if (!one) return empty;
    return summarize([one], false, one.regDomain, null);
  }
  return empty;
}

function summarize(base, skipPinned, key, keep) {
  const targets = skipPinned ? base.filter((i) => !i.pinned) : [...base];
  const hosts = new Map();
  for (const i of targets) hosts.set(i.host || groupLabel(i.regDomain), (hosts.get(i.host || groupLabel(i.regDomain)) || 0) + 1);
  const subdomains = [...hosts].map(([host, count]) => ({ host, count }))
    .sort((a, b) => (b.count - a.count) || a.host.localeCompare(b.host));
  return {
    ids: targets.map((i) => i.tabId),
    count: targets.length,
    key,
    label: groupLabel(key),
    subdomains,
    skippedPinned: base.length - targets.length,
    keep: keep ? { tabId: keep.tabId, title: keep.title || keep.url } : null,
  };
}

export function confirmText(target, mode) {
  const scope = target.subdomains.map((s) => `${s.host} ×${s.count}`).join('、');
  const skipped = target.skippedPinned ? `已固定 ${target.skippedPinned} 个不会关闭。` : '';
  const tail = `${skipped}可随时用 Ctrl+Shift+T 恢复。`;
  if (mode === 'others') {
    return `保留「${target.keep ? target.keep.title : '当前标签页'}」，关闭 ${target.label} 的其余 ${target.count} 个标签页：${scope}。${tail}`;
  }
  return `将关闭 ${target.label} 及其子域的 ${target.count} 个标签页：${scope}。${tail}`;
}
