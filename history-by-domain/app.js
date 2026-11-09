// 全屏页面板：状态机、渲染编排、事件委托、竞态控制。
// 全部状态在模块作用域内，标签页关闭即释放；不写任何持久化存储。

import { firstScreen, searchAll, iterateAll, scanHistory, deleteUrls } from './history.js';
import { normalizeItems, aggregate, classifyCards, matchesDomain, belongsToDomain, LOCAL_BUCKET } from './domain.js';
import { splitWords, rank, highlight, filterInScope } from './search.js';
import { renderRows } from './scope-view.js';

const $ = (sel) => document.querySelector(sel);
const qEl = $('#q');
const statusEl = $('#status');
const gridEl = $('#grid');
const tailSectionEl = $('#tailSection');
const tailToggleEl = $('#tailToggle');
const tailGridEl = $('#tailGrid');
const emptyEl = $('#empty');
const loadAllBtn = $('#loadAll');
const loadHintEl = $('#loadHint');
const footerActionsEl = $('#footerActions');
const scopeBarEl = $('#scopeBar');
const scopeNameEl = $('#scopeName');
const scopeViewEl = $('#scopeView');
const scopeListEl = $('#scopeList');
const scopeEmptyEl = $('#scopeEmpty');

const BATCH = 30;
const REFRESH_GAP = 60_000;
const INLINE_LIMIT = 10; // 卡内展开上限：超过则在新标签页展示完整列表（SPEC v1.1 §9.8）

const state = {
  mode: 'recent', // 'recent' | 'all' | 'search'
  prevMode: 'recent',
  basePages: new Map(), // url -> PageItem（仅内存）
  baseCards: new Map(),
  searchCards: null,
  query: '',
  generation: 0, // 异步竞态版本号
  renderGen: 0,
  allLoaded: false,
  loadingAll: false,
  cancelLoad: false,
  searchCache: new Map(), // query -> HistoryItem[]，上限 30
  cardEls: new Map(), // key -> HTMLElement（keyed DOM 复用）
  tailEls: new Map(),
  expanded: new Set(),
  tailExpanded: false,
  lastLoadAt: 0,
  confirmKey: null,     // 正在二次确认清除的卡片 key
  deleteBusy: false,    // 扫描 / 删除进行中（全局锁，避免两次全量扫描并发）
  cancelDelete: false,
  deleteView: null,     // { key, phase: scan|confirm|deleting|empty, text, urls? }
  scopeKey: null,       // v1.2 域名作用域：非 null 时搜索只在该域名内进行
  scopeQuery: '',
  scopePages: [],       // 该域名 90 天全量页面（仅内存）
  scopeCache: new Map(),// key -> PageItem[]，上限 5 个域名，标签页关闭即释放
  scopeLoading: false,
  scopeProgress: '',
  scopeGen: 0,          // 独立的竞态版本号，退出/切换作用域即作废在途扫描
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const byTime = (a, b) => b.lastVisitTime - a.lastVisitTime;

function relTime(ts) {
  if (!ts) return '时间未知';
  const d = Date.now() - ts;
  if (d < 0) return '刚刚';
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  const days = Math.floor(d / 86_400_000);
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

function fallbackTitle(p) {
  if (p.path && p.path !== '/') return p.path.length > 90 ? `${p.path.slice(0, 90)}…` : p.path;
  return p.url;
}

function faviconURL(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
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

function openDetail(key, q) {
  if (!key || key === LOCAL_BUCKET) return;
  const u = new URL(chrome.runtime.getURL('detail.html'));
  u.searchParams.set('domain', key);
  if (q && q.trim()) u.searchParams.set('q', q.trim());
  chrome.tabs.create({ url: u.toString() });
}

function findCard(key) {
  return (state.mode === 'search' && state.searchCards && state.searchCards.get(key))
    || state.baseCards.get(key)
    || null;
}

function setDeleteView(key, phase, text, extra) {
  state.deleteView = { key, phase, text, ...(extra || {}) };
}

function showHint(text, kind) {
  loadHintEl.textContent = text;
  loadHintEl.className = kind ? `hint hint--${kind}` : 'hint';
}

function cachePut(key, value) {
  if (state.searchCache.has(key)) state.searchCache.delete(key);
  state.searchCache.set(key, value);
  if (state.searchCache.size > 30) state.searchCache.delete(state.searchCache.keys().next().value);
}

function scopeCachePut(key, pages) {
  if (state.scopeCache.has(key)) state.scopeCache.delete(key);
  state.scopeCache.set(key, pages);
  if (state.scopeCache.size > 5) state.scopeCache.delete(state.scopeCache.keys().next().value);
}

function mergePages(rawItems) {
  const pages = normalizeItems(rawItems);
  for (const p of pages) {
    const prev = state.basePages.get(p.url);
    if (!prev || p.lastVisitTime > prev.lastVisitTime) state.basePages.set(p.url, p);
  }
  state.baseCards = aggregate([...state.basePages.values()]);
}

function currentView() {
  if (state.mode === 'search' && state.searchCards) {
    // 搜索态不套用长尾折叠：命中即展示。
    return { main: [...state.searchCards.values()].sort(byTime), folded: [], skipFold: true };
  }
  const { main, tail, local } = classifyCards(state.baseCards);
  return { main, folded: [...tail, ...local], skipFold: false };
}

function createCard(card) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.key = card.key;
  el.innerHTML = `
    <div class="card-head">
      <div class="fav"><img alt="" width="24" height="24" /><span class="fav-fallback"></span></div>
      <div class="meta"><div class="domain"></div><div class="stat"></div></div>
      <div class="card-tools">
        <button class="card-scope" type="button" title="仅在此域名内搜索" aria-label="仅在此域名内搜索"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.8 2a4.8 4.8 0 1 0 3 8.5l3.35 3.35 1.05-1.05-3.35-3.35A4.8 4.8 0 0 0 6.8 2zm0 1.6a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" fill="currentColor"/></svg></button>
        <button class="card-del" type="button" title="清除该域名及其子域的全部浏览记录" aria-label="清除该域名的全部浏览记录"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 1.5h4l.5 1H14v1.2H2V2.5h3.5l.5-1zM3.2 5h9.6l-.7 9.1a.9.9 0 0 1-.9.9H4.8a.9.9 0 0 1-.9-.9L3.2 5zm2.5 1.5v6.3h1.2V6.5H5.7zm3.6 0v6.3h1.2V6.5H9.3z" fill="currentColor"/></svg></button>
      </div>
    </div>
    <div class="del-bar" hidden>
      <div class="del-text"></div>
      <div class="del-actions">
        <button class="del-cancel" type="button" data-action="delete-cancel">取消</button>
        <button class="del-go" type="button" data-action="delete-confirm">确认删除</button>
      </div>
    </div>
    <ul class="pages"></ul>
    <button class="more" type="button"></button>
    <button class="detail-link" type="button" hidden></button>
  `;
  const scopeBtn = el.querySelector('.card-scope');
  scopeBtn.dataset.action = 'scope-enter';
  scopeBtn.dataset.key = card.key;
  const del = el.querySelector('.card-del');
  del.dataset.action = 'delete-ask';
  del.dataset.key = card.key;
  const img = el.querySelector('img');
  const fallback = el.querySelector('.fav-fallback');
  fallback.textContent = (card.label || '?').charAt(0).toUpperCase();
  fallback.hidden = true;
  img.addEventListener('error', () => {
    img.hidden = true;
    fallback.hidden = false;
  }, { once: true });

  if (!card.isSpecial && card.pages[0]) {
    img.src = faviconURL(card.pages[0].url);
  } else {
    img.hidden = true;
    fallback.hidden = false;
  }
  el.classList.toggle('card--special', card.isSpecial);
  return el;
}

function updateCard(el, card, words) {
  // 加载全部后 pageCount 可能从 ≤10 涨到几百，此时强制折叠，避免卡片突然被撑长。
  const expanded = state.expanded.has(card.key) && card.pageCount <= INLINE_LIMIT;
  const sig = [
    card.lastVisitTime,
    card.pageCount,
    card.totalVisits,
    expanded ? 1 : 0,
    words.join('\u0001'),
  ].join('|');

  el.querySelector('.domain').textContent = card.label;
  el.querySelector('.stat').textContent =
    `${card.pageCount} 页 · ${card.totalVisits} 次 · ${relTime(card.lastVisitTime)}`;

  const more = el.querySelector('.more');
  if (card.pageCount > INLINE_LIMIT) {
    // 超过 10 页不在卡内展开：卡会把网格列撑得极长，改由独立详情页承载。
    more.hidden = false;
    more.textContent = `在新页查看全部 ${card.pageCount} 页 ↗`;
    more.dataset.action = 'open-detail';
    more.dataset.key = card.key;
  } else if (card.pageCount > 3) {
    more.hidden = false;
    more.textContent = expanded ? '收起' : `查看全部 ${card.pageCount} 页`;
    more.dataset.action = 'expand-card';
    more.dataset.key = card.key;
  } else {
    more.hidden = true;
    more.removeAttribute('data-action');
  }

  // 卡内展开时给一个直达详情页的入口：首屏只有 200 条，
  // 当前卡片可能只是该域名历史的一小部分，详情页会做全量枚举。
  const detailLink = el.querySelector('.detail-link');
  const canDetail = expanded && !card.isSpecial;
  detailLink.hidden = !canDetail;
  if (canDetail) {
    detailLink.textContent = '在新页查看该域名完整列表 ↗';
    detailLink.dataset.action = 'open-detail';
    detailLink.dataset.key = card.key;
  }

  const scopeBtn = el.querySelector('.card-scope');
  scopeBtn.hidden = card.isSpecial; // 「本地 / 其他」不是域名，不给域内搜索入口
  scopeBtn.dataset.key = card.key;
  const del = el.querySelector('.card-del');
  del.hidden = card.isSpecial; // 同理，不给清除入口
  del.disabled = state.deleteBusy;
  del.dataset.key = card.key;

  const bar = el.querySelector('.del-bar');
  const dv = state.deleteView;
  const showBar = !!dv && dv.key === card.key;
  bar.hidden = !showBar;
  bar.classList.toggle('is-danger', showBar && dv.phase === 'confirm');
  el.classList.toggle('card--pending', showBar);
  if (showBar) {
    el.querySelector('.del-text').textContent = dv.text;
    const cancelBtn = el.querySelector('.del-cancel');
    const goBtn = el.querySelector('.del-go');
    cancelBtn.dataset.key = card.key;
    goBtn.dataset.key = card.key;
    goBtn.hidden = dv.phase !== 'confirm';
    goBtn.disabled = state.deleteBusy;
  }
  el.classList.toggle('card--special', card.isSpecial);

  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  const list = el.querySelector('.pages');
  const shown = expanded ? card.pages : card.pages.slice(0, 3);
  const frag = document.createDocumentFragment();
  for (const p of shown) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'page-link';
    a.href = p.url; // 点击时 preventDefault + 协议白名单校验
    a.setAttribute('data-action', 'open-page');
    a.setAttribute('data-url', p.url);
    a.title = p.title || p.url;

    const title = document.createElement('span');
    title.className = 'p-title';
    title.innerHTML = highlight(p.title || fallbackTitle(p), words); // highlight 已转义

    const time = document.createElement('span');
    time.className = 'p-time';
    time.textContent = relTime(p.lastVisitTime);

    a.append(title, time);
    li.append(a);
    frag.append(li);
  }
  list.replaceChildren(frag);
}

async function syncGrid(container, cards, elsMap, words, g) {
  const wanted = new Set(cards.map((c) => c.key));
  for (const [key, el] of elsMap) if (!wanted.has(key)) el.hidden = true;

  for (let i = 0; i < cards.length; i += BATCH) {
    if (g !== state.renderGen) return;
    for (const card of cards.slice(i, i + BATCH)) {
      let el = elsMap.get(card.key);
      if (!el) {
        el = createCard(card);
        elsMap.set(card.key, el);
      }
      updateCard(el, card, words);
      el.hidden = false;
      container.appendChild(el);
    }
    if (i + BATCH < cards.length) await nextFrame();
  }
}

function updateStatus(view) {
  const pages = (cards) => cards.reduce((n, c) => n + c.pageCount, 0);
  const totalPages = pages(view.main) + pages(view.folded);
  if (state.mode === 'search') {
    statusEl.textContent = `找到 ${view.main.length} 个域名 · ${totalPages} 个页面 · 搜索范围：浏览器全部历史`;
  } else if (state.loadingAll) {
    statusEl.textContent = `正在加载全部历史… ${view.main.length + view.folded.length} 个域名`;
  } else {
    statusEl.textContent = `${state.allLoaded ? '全部' : '最近'} ${view.main.length + view.folded.length} 个域名 · ${totalPages} 个页面 · 数据来自浏览器历史（约 90 天）`;
  }
}

async function renderScope(g) {
  const key = state.scopeKey;
  const card = state.baseCards.get(key) || findCard(key);
  const label = (card && card.label) || key;
  const words = splitWords(state.scopeQuery);
  const rows = filterInScope(state.scopePages, state.scopeQuery);
  const totalVisits = state.scopePages.reduce((n, p) => n + (p.visitCount || 0), 0);

  scopeNameEl.textContent = label;
  qEl.placeholder = `在 ${label} 内搜索标题或网址`;
  scopeEmptyEl.hidden = rows.length > 0;
  if (!rows.length) {
    scopeEmptyEl.textContent = state.scopeQuery
      ? `在 ${label} 内没有找到与「${state.scopeQuery}」相关的页面`
      : '该域名没有可展示的历史记录';
  }
  statusEl.textContent = state.scopeLoading
    ? `正在补全 ${label} 的全部历史… ${state.scopeProgress}`
    : `仅搜索 ${label} · 命中 ${rows.length} / ${state.scopePages.length} 个页面 · 累计 ${totalVisits} 次访问`;

  await renderRows(scopeListEl, rows, words, () => g !== state.renderGen);
}

async function render() {
  const g = ++state.renderGen;

  if (state.scopeKey) {
    // 域名作用域：隐藏卡片墙，改用全宽结果列表（不把长列表塞进卡片）。
    gridEl.hidden = true;
    tailSectionEl.hidden = true;
    footerActionsEl.hidden = true;
    emptyEl.hidden = true;
    scopeBarEl.hidden = false;
    scopeViewEl.hidden = false;
    await renderScope(g);
    return;
  }

  gridEl.hidden = false;
  footerActionsEl.hidden = false;
  scopeBarEl.hidden = true;
  scopeViewEl.hidden = true;
  qEl.placeholder = '搜索域名或页面标题';
  const view = currentView();
  const words = state.mode === 'search' ? splitWords(state.query) : [];

  await syncGrid(gridEl, view.main, state.cardEls, words, g);
  if (g !== state.renderGen) return;

  tailSectionEl.hidden = view.skipFold || view.folded.length === 0;
  tailToggleEl.textContent = `${state.tailExpanded ? '收起' : '展开'}其它 ${view.folded.length} 个域名`;
  tailGridEl.hidden = tailSectionEl.hidden || !state.tailExpanded;

  if (!tailGridEl.hidden) {
    await syncGrid(tailGridEl, view.folded, state.tailEls, words, g);
    if (g !== state.renderGen) return;
  } else {
    for (const el of state.tailEls.values()) el.hidden = true;
  }

  const isEmpty = view.main.length === 0 && view.folded.length === 0;
  emptyEl.hidden = !isEmpty;
  if (isEmpty) {
    emptyEl.textContent = state.mode === 'search'
      ? `没有找到与「${state.query}」相关的历史记录`
      : '浏览器历史里还没有可展示的记录';
  }

  loadAllBtn.hidden = state.mode === 'search' || state.scopeKey;
  loadAllBtn.disabled = state.allLoaded || state.loadingAll || state.deleteBusy;
  if (state.allLoaded) loadAllBtn.textContent = '已加载全部';
  updateStatus(view);
}

async function runSearch(q) {
  const gen = ++state.generation;
  if (state.mode !== 'search') state.prevMode = state.mode;
  state.mode = 'search';
  state.query = q;
  statusEl.textContent = '搜索中…';

  let raw = state.searchCache.get(q);
  if (!raw) {
    raw = await searchAll(q);
    if (gen !== state.generation) return;
    cachePut(q, raw);
  }
  const words = splitWords(q);
  const ranked = rank(normalizeItems(raw), words);
  state.searchCards = aggregate(ranked);
  await render();
}

function clearSearch() {
  state.generation += 1;
  state.mode = state.allLoaded ? 'all' : state.prevMode;
  state.query = '';
  state.searchCards = null;
  render();
}

// 域名作用域：进入时先用已加载数据秒出，再后台跑一次全量分段补齐；
// 之后每次输入都是纯内存过滤，零 history 调用（SPEC v1.2 §6.8）。
async function enterScope(key) {
  if (!key || key === LOCAL_BUCKET) return;
  state.scopeKey = key;
  state.scopeQuery = qEl.value.trim();
  state.scopeLoading = false;
  state.scopeProgress = '';
  const gen = ++state.scopeGen;

  if (state.scopeCache.has(key)) {
    state.scopePages = state.scopeCache.get(key);
    await render();
    return;
  }

  // 渐进第一步：已加载的数据立即可用（首屏 200 条可能只覆盖该域名的一部分）。
  state.scopePages = [...state.basePages.values()]
    .filter((p) => p.regDomain === key)
    .sort(byTime);
  state.scopeLoading = true;
  await render();

  const scan = await scanHistory(
    (item) => belongsToDomain(item, key),
    (loaded, total, found) => {
      if (gen !== state.scopeGen) return;
      state.scopeProgress = `${loaded}/${total} 周，已找到 ${found} 个页面`;
      render();
    },
    () => gen !== state.scopeGen,
  );
  if (gen !== state.scopeGen) return;

  state.scopePages = normalizeItems(scan.items)
    .filter((p) => p.regDomain === key)
    .sort(byTime);
  scopeCachePut(key, state.scopePages);
  state.scopeLoading = false;
  await render();
}

function exitScope() {
  if (!state.scopeKey) return;
  state.scopeKey = null;
  state.scopeLoading = false;
  state.scopePages = [];
  state.scopeQuery = '';
  state.scopeGen += 1; // 作废在途扫描
  const q = qEl.value.trim();
  // 同一个词自动扩大到全局搜索，不用重打一遍。
  if (q.length >= 2) runSearch(q);
  else clearSearch();
}

async function loadAll() {
  if (state.loadingAll || state.allLoaded || state.mode === 'search' || state.deleteBusy || state.scopeKey) return;
  state.loadingAll = true;
  state.cancelLoad = false;
  const gen = state.generation;
  loadAllBtn.disabled = true;
  try {
    for await (const batch of iterateAll(() => state.cancelLoad || state.generation !== gen)) {
      mergePages(batch.items);
      loadHintEl.textContent = `已加载 ${batch.loaded} / ${batch.total} 周`;
      await render();
    }
    if (!state.cancelLoad && state.generation === gen) {
      state.allLoaded = true;
      state.mode = 'all';
      loadHintEl.textContent = '';
    }
  } catch (err) {
    console.warn('[loadAll]', err);
    loadHintEl.textContent = '加载中断，可重试';
  } finally {
    state.loadingAll = false;
    loadAllBtn.disabled = state.allLoaded;
    render();
  }
}

// 清除某域名：先只读全量统计（用户能看到准确数量与范围），再等第二次点击才真正删除。
// 两个阶段共用 scanHistory 的按周分段口径，且删除必须在收集完成之后开始。
async function askDelete(key) {
  if (state.deleteBusy || !key || key === LOCAL_BUCKET) return;
  const card = findCard(key);
  if (!card || card.isSpecial) return;

  state.cancelLoad = true; // 别和全量扫描抢 history API
  state.confirmKey = key;
  state.cancelDelete = false;
  state.deleteBusy = true;
  showHint('');
  setDeleteView(key, 'scan', `正在统计 ${card.label} 及其子域的全部历史…`);
  render();

  const scan = await scanHistory(
    (item) => matchesDomain(item, key),
    (loaded, total, found) => {
      setDeleteView(key, 'scan', `正在统计 ${card.label}… ${loaded}/${total} 周，已找到 ${found} 个页面`);
      render();
    },
    () => state.cancelDelete || state.confirmKey !== key,
  );

  state.deleteBusy = false;
  if (state.cancelDelete || state.confirmKey !== key || scan.cancelled) {
    state.deleteView = null;
    render();
    return;
  }
  if (!scan.urls.length) {
    setDeleteView(key, 'empty', `没有找到 ${card.label} 的可删除历史记录`);
    render();
    setTimeout(() => {
      if (state.deleteView && state.deleteView.phase === 'empty') {
        state.deleteView = null;
        render();
      }
    }, 3000);
    return;
  }
  setDeleteView(
    key,
    'confirm',
    `将永久删除 ${card.label} 及其所有子域的 ${scan.urls.length} 个页面（累计 ${scan.visits} 次访问）。此操作不可撤销。`,
    { urls: scan.urls },
  );
  render();
}

async function confirmDelete(key) {
  const dv = state.deleteView;
  if (!dv || dv.key !== key || dv.phase !== 'confirm' || state.deleteBusy) return;
  const urls = dv.urls;
  state.deleteBusy = true;
  state.cancelDelete = false;
  setDeleteView(key, 'deleting', `正在删除 ${key} 的 0/${urls.length} 个页面…`);
  render();

  const result = await deleteUrls(
    urls,
    (done, total, failed) => {
      setDeleteView(key, 'deleting', `正在删除 ${key} 的 ${done}/${total} 个页面${failed ? `（${failed} 个失败）` : ''}…`);
      render();
    },
    () => state.cancelDelete || state.confirmKey !== key,
  );

  // 同步内存视图。按 regDomain 兜底清理：basePages 的 key 是 u.href 归一化后的 URL，
  // 而 deleteUrls 传回的是 Chrome 原始 item.url，两者形式可能不同（如尾部斜杠）。
  const removed = new Set(result.deletedUrls);
  for (const [url, p] of state.basePages) {
    if (removed.has(url) || p.regDomain === key) state.basePages.delete(url);
  }
  state.baseCards = aggregate([...state.basePages.values()]);
  // 必须失效：否则再次搜索同一关键词时，已删页面会从缓存里"复活"到卡片墙上。
  state.searchCache.clear();
  state.scopeCache.delete(key); // 该域名的全量缓存已失效，下次进入需重新枚举
  for (const map of [state.cardEls, state.tailEls]) {
    const el = map.get(key);
    if (el) { el.remove(); map.delete(key); }
  }
  state.expanded.delete(key);
  state.confirmKey = null;
  state.deleteView = null;
  state.deleteBusy = false;

  const bits = [`已清除 ${key} 的 ${result.deleted} 个页面`];
  if (result.failed) bits.push(`${result.failed} 个删除失败`);
  if (result.cancelled) bits.push('已中途取消');
  showHint(bits.join('，'), result.failed ? 'warn' : 'ok');

  // 极端情况下（如从消息通道触发）作用域正指向被清空的域名，直接退出。
  if (state.scopeKey === key) { exitScope(); return; }
  if (state.mode === 'search' && state.query) await runSearch(state.query);
  else await render();
}

let debounceTimer = 0;
qEl.addEventListener('input', () => {
  const v = qEl.value.trim();
  clearTimeout(debounceTimer);
  if (state.scopeKey) {
    // 域内搜索是纯内存过滤：不需要 ≥2 字符门槛，防抖也可以更短。
    state.scopeQuery = v;
    debounceTimer = setTimeout(() => { render(); }, 120);
    return;
  }
  if (v.length < 2) {
    if (state.mode === 'search') clearSearch();
    return;
  }
  debounceTimer = setTimeout(() => { runSearch(v); }, 200);
});

qEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.scopeKey) {
    e.preventDefault();
    exitScope();
  }
});

loadAllBtn.addEventListener('click', () => { loadAll(); });

document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!target) return;
  const { action, url, key } = target.dataset;
  if (action === 'open-page') {
    e.preventDefault();
    openPage(url);
  } else if (action === 'expand-card' && key) {
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    render();
  } else if (action === 'tail-toggle') {
    state.tailExpanded = !state.tailExpanded;
    render();
  } else if (action === 'open-detail' && key) {
    e.preventDefault();
    openDetail(key);
  } else if (action === 'delete-ask' && key) {
    e.preventDefault();
    askDelete(key);
  } else if (action === 'delete-cancel') {
    state.cancelDelete = true;
    state.confirmKey = null;
    state.deleteView = null;
    render();
  } else if (action === 'delete-confirm' && key) {
    e.preventDefault();
    confirmDelete(key);
  } else if (action === 'scope-enter' && key) {
    e.preventDefault();
    enterScope(key);
  } else if (action === 'scope-exit') {
    e.preventDefault();
    exitScope();
  } else if (action === 'scope-open-detail') {
    e.preventDefault();
    openDetail(state.scopeKey, state.scopeQuery);
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (state.mode === 'search' || state.loadingAll || state.deleteBusy || state.scopeKey) return;
  if (Date.now() - state.lastLoadAt < REFRESH_GAP) return;
  // 只做增量补充新访问；删除历史由用户刷新页面（F5）体现。
  mergePages(await firstScreen());
  state.lastLoadAt = Date.now();
  render();
});

// 缓存本标签的 id/windowId，让 panel-ping 能同步回包。
// 同步响应可以避免广播中其它上下文关闭端口时，发送方过早拿到 undefined。
let selfTab = null;
try {
  chrome.tabs.getCurrent().then((tab) => { selfTab = tab; }).catch(() => {});
} catch { /* 非标签上下文，走下面的异步兜底 */ }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'panel-ping') {
    if (selfTab && selfTab.id != null) {
      sendResponse({ tabId: selfTab.id, windowId: selfTab.windowId });
      return;
    }
    chrome.tabs.getCurrent()
      .then((tab) => sendResponse({ tabId: tab && tab.id, windowId: tab && tab.windowId }))
      .catch(() => sendResponse({}));
    return true; // 异步响应
  }
  if (msg && msg.type === 'panel-query') {
    const q = String(msg.q || '').trim();
    qEl.value = q;
    if (state.scopeKey) { exitScope(); return; } // omnibox 是全局入口，先撤掉域名限定
    if (q.length >= 2) runSearch(q);
    else clearSearch();
  }
});

async function init() {
  const initialQuery = new URLSearchParams(location.search).get('q') || '';
  mergePages(await firstScreen());
  state.lastLoadAt = Date.now();
  await render();
  if (initialQuery.trim().length >= 2) {
    qEl.value = initialQuery;
    runSearch(initialQuery.trim());
  }
  qEl.focus();
}

init();
