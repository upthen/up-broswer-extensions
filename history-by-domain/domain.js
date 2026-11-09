// 域名归组：eTLD+1 合并子域、特殊 URL 归档、PageItem 归一化与卡片聚合。
// 本模块是纯逻辑，不依赖任何 chrome.* API，便于独立测试。

import { PSL_SET } from './psl-data.js';

export const LOCAL_BUCKET = '__local__';
const TAIL_AGE = 7 * 86400_000;

function isIpOrLocal(host) {
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.startsWith('[') || host.includes(':')) return true; // IPv6 字面量
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;      // IPv4
  return false;
}

// 从右往左找最长匹配的公共后缀，返回它占几个 label；未命中返回 0。
function suffixLabelCount(labels) {
  let best = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    if (PSL_SET.has(candidate)) best = Math.max(best, labels.length - i);
  }
  return best;
}

export function getRegDomain(host) {
  if (!host) return LOCAL_BUCKET;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (isIpOrLocal(h)) return LOCAL_BUCKET;
  const labels = h.split('.');
  if (labels.length === 1) return h; // 带名字的内网主机，如 uih-office
  const k = suffixLabelCount(labels) || 1;
  return labels.slice(-(k + 1)).join('.');
}

function specialItem(item, url) {
  return {
    url: url || (item && item.url) || '',
    title: (item && item.title) || '',
    lastVisitTime: Number(item && item.lastVisitTime) || 0,
    visitCount: Number(item && item.visitCount) || 0,
    host: '',
    path: '',
    regDomain: LOCAL_BUCKET,
    isSpecial: true,
  };
}

export function normalizeItem(item) {
  if (!item || !item.url) return null;
  let u;
  try {
    u = new URL(item.url);
  } catch {
    return specialItem(item, item.url);
  }
  const isWeb = u.protocol === 'http:' || u.protocol === 'https:';
  if (!isWeb || !u.hostname) return specialItem(item, u.href);

  const host = u.hostname.toLowerCase();
  const regDomain = getRegDomain(host);
  return {
    url: u.href,
    title: item.title || '',
    lastVisitTime: Number(item.lastVisitTime) || 0,
    visitCount: Number(item.visitCount) || 0,
    host,
    path: u.pathname || '/',
    regDomain,
    isSpecial: regDomain === LOCAL_BUCKET,
  };
}

// Chrome HistoryItem[] -> PageItem[]，按 url 去重（保留最后一次访问）。
export function normalizeItems(items) {
  const dedup = new Map();
  for (const item of items || []) {
    const p = normalizeItem(item);
    if (!p) continue;
    const prev = dedup.get(p.url);
    if (!prev || p.lastVisitTime > prev.lastVisitTime) dedup.set(p.url, p);
  }
  return [...dedup.values()];
}

// PageItem[] -> Map<regDomain, DomainCard>
export function aggregate(pages, now = Date.now()) {
  const dedup = new Map();
  for (const p of pages) {
    const prev = dedup.get(p.url);
    if (!prev || p.lastVisitTime > prev.lastVisitTime) dedup.set(p.url, p);
  }

  const cards = new Map();
  for (const p of dedup.values()) {
    let card = cards.get(p.regDomain);
    if (!card) {
      card = {
        key: p.regDomain,
        label: p.regDomain === LOCAL_BUCKET ? '本地 / 其他' : p.regDomain,
        hosts: new Set(),
        pages: [],
        pageCount: 0,
        totalVisits: 0,
        lastVisitTime: 0,
        isTail: false,
        isSpecial: p.regDomain === LOCAL_BUCKET,
      };
      cards.set(card.key, card);
    }
    card.hosts.add(p.host);
    card.pages.push(p);
  }

  for (const card of cards.values()) {
    card.pages.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    card.pageCount = card.pages.length;
    card.totalVisits = card.pages.reduce((n, p) => n + p.visitCount, 0);
    card.lastVisitTime = card.pages[0] ? card.pages[0].lastVisitTime : 0;
    // AND 而非 OR：避免把常去但久未访问的老站也折叠掉。
    card.isTail = !card.isSpecial
      && card.totalVisits <= 1
      && (now - card.lastVisitTime > TAIL_AGE);
  }
  return cards;
}

export function classifyCards(cards) {
  const main = [];
  const tail = [];
  const local = [];
  for (const c of cards.values()) {
    if (c.isSpecial) local.push(c);
    else if (c.isTail) tail.push(c);
    else main.push(c);
  }
  const byTime = (a, b) => b.lastVisitTime - a.lastVisitTime;
  main.sort(byTime);
  tail.sort(byTime);
  local.sort(byTime);
  return { main, tail, local };
}

// 归属判定：与 aggregate 使用同一个 normalizeItem / getRegDomain 口径，
// 保证详情页列举、按域名删除与卡片聚合三者不会错位。
export function belongsToDomain(item, key) {
  if (!item || !item.url || !key) return false;
  const p = normalizeItem(item);
  return !!p && p.regDomain === key;
}

// 删除专用：'本地 / 其他' 桶混杂 chrome:// / file:// / localhost / 内网主机，
// 不是"某域名"，删除语义不清，直接拒绝。
export function matchesDomain(item, key) {
  if (!key || key === LOCAL_BUCKET) return false;
  return belongsToDomain(item, key);
}
