// 域名详情页：由主面板在 pageCount > 10 时新标签打开，或从「域名作用域」带关键词打开。
// 刻意不注册 chrome.runtime.onMessage —— 一旦响应 panel-ping 就会抢答单实例握手，
// 导致点工具栏图标时 focus 到详情页而不是卡片墙（SPEC §9.4 / §9.8）。
// 「返回卡片墙」由本页直接执行 panel-focus.js，不经 service worker（v1.2.1）。

import { scanHistory } from './history.js';
import { normalizeItems, belongsToDomain, LOCAL_BUCKET } from './domain.js';
import { filterInScope, splitWords } from './search.js';
import { renderRows } from './scope-view.js';
import { focusPanel } from './panel-focus.js';

const $ = (sel) => document.querySelector(sel);
const titleEl = $('#detailTitle');
const subEl = $('#detailSub');
const filterEl = $('#filter');
const listEl = $('#detailList');
const emptyEl = $('#detailEmpty');

let pages = [];
let renderGen = 0;

function validKey(k) {
  return !!k && k !== LOCAL_BUCKET && k.length <= 253 && /^[a-z0-9.-]+$/i.test(k);
}

function showError(text) {
  subEl.textContent = '';
  listEl.hidden = true;
  emptyEl.hidden = false;
  emptyEl.textContent = text;
}

function openPage(url) {
  if (!url) return;
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  chrome.tabs.create({ url: u.href });
}

// 与主面板的域名作用域共用同一套匹配、排序、高亮与行渲染（SPEC v1.2 §6.8 / §9.9）。
async function renderList() {
  const g = ++renderGen;
  const q = filterEl.value.trim();
  const words = splitWords(q);
  const rows = filterInScope(pages, q);
  const totalVisits = pages.reduce((n, p) => n + (p.visitCount || 0), 0);

  subEl.textContent = `${rows.length} / ${pages.length} 个页面 · 累计 ${totalVisits} 次访问`;
  emptyEl.hidden = rows.length > 0;
  if (!rows.length) emptyEl.textContent = q ? `没有匹配「${q}」的页面` : '该域名没有可展示的历史记录';

  await renderRows(listEl, rows, words, () => g !== renderGen);
}

const backEl = $('#back');
backEl.addEventListener('click', async () => {
  if (backEl.disabled) return;
  const label = backEl.textContent;
  backEl.disabled = true;
  backEl.textContent = '正在返回…';
  // 直接在本页完成握手：主面板已开则 focus，未开/失联则新开一个，点击必有可见结果。
  const result = await focusPanel();
  console.info('[panel-focus] result:', result);
  backEl.disabled = false;
  if (result === 'focused') {
    backEl.textContent = label;
  } else {
    backEl.textContent = result === 'created' ? '已新开卡片墙' : '返回失败，请点工具栏图标';
    setTimeout(() => { backEl.textContent = label; }, 3000);
  }
});

let filterTimer = 0;
filterEl.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderList, 120);
});

listEl.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('[data-action="open-page"]') : null;
  if (!a) return;
  e.preventDefault();
  openPage(a.dataset.url);
});

async function init() {
  const params = new URLSearchParams(location.search);
  const key = params.get('domain') || '';
  const initialQuery = params.get('q') || '';
  if (!validKey(key)) {
    titleEl.textContent = '无法打开详情';
    showError('缺少有效的域名参数。请从卡片墙上的「在新页查看」入口打开本页。');
    return;
  }
  titleEl.textContent = key;
  document.title = `${key} · 历史详情`;
  filterEl.placeholder = `在 ${key} 内搜索标题或网址`;
  filterEl.value = initialQuery;

  // 复用与主面板「清除」「域名作用域」完全相同的全量分段口径，保证三处范围一致。
  const scan = await scanHistory(
    (item) => belongsToDomain(item, key),
    (loaded, total, found) => {
      subEl.textContent = `正在读取… ${loaded}/${total} 周，已找到 ${found} 个页面`;
    },
    () => false,
  );

  pages = normalizeItems(scan.items)
    .filter((p) => p.regDomain === key && !p.isSpecial)
    .sort((a, b) => b.lastVisitTime - a.lastVisitTime);

  filterEl.focus();
  await renderList();
}

init();
