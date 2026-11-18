// 详情页：由主面板在书签数 > 10 时新标签打开，或从「域内 / 文件夹作用域」带关键词打开。
// 刻意不注册 chrome.runtime.onMessage —— 一旦响应 panel-ping 就会抢答单实例握手，
// 导致点工具栏图标时 focus 到详情页而不是卡片墙（SPEC §9.4 / §9.8）。
// 「返回卡片墙」由本页直接执行 panel-focus.js，不经 service worker（v1.2.1）。
// v1.3.0：source=bookmarks 只读书签详情；§16.13 新增 folder=<id> 按文件夹子树展示。

import { scanHistory } from './history.js';
import { normalizeItems, belongsToDomain, LOCAL_BUCKET } from './domain.js';
import { filterInScope, splitWords } from './search.js';
import { readAll, filterBookmarks, subtreePages, folderPathOf } from './bookmarks.js';
import { renderRows } from './scope-view.js';
import { focusPanel } from './panel-focus.js';

const $ = (sel) => document.querySelector(sel);
const titleEl = $('#detailTitle');
const subEl = $('#detailSub');
const filterEl = $('#filter');
const listEl = $('#detailList');
const emptyEl = $('#detailEmpty');
const noteEl = $('#detailNote');

let pages = [];
let renderGen = 0;
let isBookmarks = false;      // source=bookmarks：只读，绝不进入 scanHistory 分支
let isFolderDetail = false;   // §16.13：source=bookmarks&folder=<id> 按文件夹子树展示
let scopeLabel = '';          // 页标题 / placeholder 使用的范围名

function validKey(k) {
  return !!k && k !== LOCAL_BUCKET && k.length <= 253 && /^[a-z0-9.-]+$/i.test(k);
}

function validFolderId(id) {
  return !!id && id.length <= 64 && /^[0-9a-zA-Z_-]+$/.test(id);
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

// 与主面板的作用域共用同一套匹配、排序、高亮与行渲染（SPEC §6.8 / §9.9 / §16.13）。
async function renderList() {
  const g = ++renderGen;
  const q = filterEl.value.trim();
  const words = splitWords(q);
  const rows = isBookmarks ? filterBookmarks(pages, q) : filterInScope(pages, q);
  const totalVisits = pages.reduce((n, p) => n + (p.visitCount || 0), 0);

  subEl.textContent = isFolderDetail
    ? `命中 ${rows.length} / ${pages.length} 个书签 · 只读 · 含所有子文件夹`
    : isBookmarks
      ? `命中 ${rows.length} / ${pages.length} 个书签 · 只读 · 按最近添加排序`
      : `${rows.length} / ${pages.length} 个页面 · 累计 ${totalVisits} 次访问`;
  emptyEl.hidden = rows.length > 0;
  if (!rows.length) {
    emptyEl.textContent = q
      ? `没有匹配「${q}」的${isBookmarks ? '书签' : '页面'}`
      : (isFolderDetail ? '该文件夹下没有可展示的书签'
        : (isBookmarks ? '该域名下没有可展示的书签' : '该域名没有可展示的历史记录'));
  }

  // 书签行显示「添加于 X 前」+ 文件夹面包屑，不显示「N 次访问」。
  await renderRows(listEl, rows, words, () => g !== renderGen, isBookmarks ? { bookmarks: true } : undefined);
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

// 两条说明都是本文件的静态字面量，用纯 DOM 拼装，不引入 innerHTML（§16.7-13）。
function note(text, strongText, tail) {
  const strong = document.createElement('strong');
  strong.textContent = strongText;
  noteEl.replaceChildren(document.createTextNode(text), strong, document.createTextNode(tail));
}

async function init() {
  const params = new URLSearchParams(location.search);
  const key = params.get('domain') || '';
  const folderId = params.get('folder') || '';
  const initialQuery = params.get('q') || '';
  isBookmarks = params.get('source') === 'bookmarks';
  isFolderDetail = isBookmarks && validFolderId(folderId);

  const keyOk = isFolderDetail ? true : validKey(key);
  if (!keyOk) {
    titleEl.textContent = '无法打开详情';
    showError('缺少有效的域名或文件夹参数。请从卡片墙上的「在新页查看」入口打开本页。');
    return;
  }

  scopeLabel = isFolderDetail ? folderId : key;
  filterEl.value = initialQuery;

  if (isBookmarks) {
    // §16.5 / §16.13：详情页只读，一次 getTree() 后纯内存过滤，不调 scanHistory、不写任何 API。
    let data;
    try {
      data = await readAll();
    } catch (err) {
      showError(`读取书签失败：${String((err && err.message) || err)}。请确认已授予书签权限并刷新扩展。`);
      return;
    }
    if (isFolderDetail) {
      const path = folderPathOf(data, folderId);
      scopeLabel = path.length ? path.join(' / ') : '未命名文件夹';
      pages = subtreePages(data, folderId).sort((a, b) => b.dateAdded - a.dateAdded);
      titleEl.textContent = scopeLabel;
      document.title = `${scopeLabel} · 书签文件夹详情`;
      filterEl.placeholder = `在文件夹「${scopeLabel}」内搜索书签`;
      note('列表来自浏览器自身的书签库，含该文件夹及其所有子文件夹，按最近添加排序。',
        '本页只读',
        '，不提供任何新建 / 改名 / 删除入口；如需管理书签请回卡片墙。上方输入框仅在该文件夹内搜索，支持多词（空格分隔、需全部命中）并高亮命中词；点击标题在新标签打开。');
    } else {
      pages = data.pages
        .filter((p) => p.regDomain === key && !p.isSpecial)
        .sort((a, b) => b.dateAdded - a.dateAdded);
      titleEl.textContent = key;
      document.title = `${key} · 书签详情`;
      filterEl.placeholder = `在 ${key} 内搜索书签标题、网址或文件夹`;
      note('列表来自浏览器自身的书签库，含该域名及其所有子域，按最近添加排序。',
        '本页只读',
        '，不提供任何新建 / 改名 / 删除入口；如需管理书签请回卡片墙。上方输入框仅在本域名内搜索，支持多词（空格分隔、需全部命中）并高亮命中词；点击标题在新标签打开。');
    }
  } else {
    titleEl.textContent = key;
    document.title = `${key} · 历史详情`;
    filterEl.placeholder = `在 ${key} 内搜索标题或网址`;
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
  }

  filterEl.focus();
  await renderList();
}

init();
