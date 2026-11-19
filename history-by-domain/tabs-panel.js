// 标签页 tab 视图层（SPEC v1.4.0，v1.5.0 起按主机名成卡）：只读标签元数据、按站点成卡、点击聚焦。
// 与 app.js 的历史侧刻意隔离：模块只在切到「标签页」时动态加载，
// 只在激活且可见时读取，不注册任何 chrome.tabs 事件监听，不写任何存储。

import { normalizeTabs, buildGroups, computeRemoveTargets, closeToast, pickActionKey, CLOSE_MODE } from './tabs.js';

const $ = (s) => document.querySelector(s);
const viewEl = $('#tabsView');
const gridEl = $('#tabsGrid');
const emptyEl = $('#tabsEmpty');
const countEl = $('#tabsCount');
const statusEl = $('#status');
const qEl = $('#q');
const toastEl = $('#tabsToast');

const selfOrigin = chrome.runtime.getURL('');

const state = {
  active: false,
  items: [],
  query: '',
  busy: false,
  loadGen: 0,
};

const cardEls = new Map();
let toastTimer = 0;

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function faviconURL(url) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', '32');
  return u.toString();
}

const ICON = {
  close: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6zm2.5 8.1-.9.9L8 8.9l-1.6 1.7-.9-.9L7.1 8 5.5 6.4l.9-.9L8 7.1l1.6-1.6.9.9L8.9 8l1.6 1.7z" fill="currentColor"/></svg>',
  others: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3h1.6v10H2V3zm3.2 3h8.8v1.4H5.2V6zm0 3.6h8.8v1.4H5.2V9.6z" fill="currentColor"/></svg>',
  // 组级关闭：粗 ×（无圆圈），与行内的圈 × 区分开
  closeAll: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.1 2.05 8 6.95l4.9-4.9 1.05 1.05L9.05 8l4.9 4.9-1.05 1.05L8 9.05l-4.9 4.9L2.05 12.9 6.95 8 2.05 3.1z" fill="currentColor"/></svg>',
};

function createCard(group) {
  const el = document.createElement('article');
  el.className = 'card card--tabs';
  el.dataset.key = group.key;
  el.innerHTML = `
    <div class="card-head">
      <div class="fav"><img alt="" width="24" height="24" hidden /><span class="fav-fallback"></span></div>
      <div class="meta"><div class="domain"></div><div class="stat"></div></div>
      <div class="card-tools">
        <button class="bm-op bm-op--icon bm-op--del tabs-close-all" type="button" data-action="tabs-close-group" title="关闭该站点全部标签页" aria-label="关闭该站点全部标签页">${ICON.closeAll}</button>
      </div>
    </div>
    <ul class="pages"></ul>
  `;
  const fallback = el.querySelector('.fav-fallback');
  fallback.textContent = (group.label || '?').charAt(0).toUpperCase();
  const img = el.querySelector('img');
  img.addEventListener('error', () => { img.hidden = true; fallback.hidden = false; }, { once: true });
  return el;
}

// 卡片标题已经是完整主机名，行内再重复一遍纯属噪音；改用路径/协议区分同站的多个页面。
function trailOf(item) {
  if (item.isSpecial) {
    try {
      const u = new URL(item.url);
      return `${u.protocol.replace(':', '')}${u.hostname ? `://${u.hostname}` : ''}`;
    } catch {
      return '';
    }
  }
  return item.path && item.path !== '/' ? item.path : '';
}

function rowMeta(item, multiWindow) {
  const bits = [];
  const trail = trailOf(item);
  if (trail) bits.push(trail);
  if (multiWindow) bits.push(`窗口 ${item.windowId}`);
  if (item.pinned) bits.push('已固定');
  if (item.isDuplicate) bits.push('重复');
  return bits.join(' · ');
}

function updateCard(el, group, multiWindow) {
  el.querySelector('.domain').textContent = group.label;
  el.querySelector('.stat').textContent = `${group.count} 个标签页`;
  el.classList.toggle('card--special', group.isSpecial);

  const img = el.querySelector('img');
  const fallback = el.querySelector('.fav-fallback');
  const pageUrl = !group.isSpecial && group.tabs[0] ? group.tabs[0].url : '';
  if (pageUrl && img.dataset.pageUrl !== pageUrl) {
    img.src = faviconURL(pageUrl);
    img.dataset.pageUrl = pageUrl;
    img.hidden = false;
    fallback.hidden = true;
  } else if (!pageUrl) {
    img.removeAttribute('src');
    delete img.dataset.pageUrl;
    img.hidden = true;
    fallback.hidden = false;
  }

  const closeAll = el.querySelector('.tabs-close-all');
  closeAll.hidden = group.isSpecial;
  closeAll.disabled = state.busy;
  closeAll.dataset.key = group.key;

  // v1.5.4 起不做折叠：卡片直接铺满该主机名的全部标签，高度差异交给瀑布流吸收。
  const list = el.querySelector('.pages');
  const frag = document.createDocumentFragment();
  for (const item of group.tabs) {
    const li = document.createElement('li');
    li.className = 'tab-row';

    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'tab-focus';
    focus.dataset.action = 'tab-focus';
    focus.dataset.id = String(item.tabId);
    focus.title = `${item.title || item.url}\n${item.url}`;
    focus.setAttribute('aria-label', `跳转到 ${item.title || item.url}`);

    const title = document.createElement('span');
    title.className = 'p-title';
    title.textContent = item.title || item.url;
    const meta = document.createElement('span');
    meta.className = 'tab-meta';
    meta.textContent = rowMeta(item, multiWindow);
    focus.append(title, meta);

    const ops = document.createElement('span');
    ops.className = 'tab-ops';
    ops.innerHTML = `
      <button class="bm-op bm-op--icon tab-op" type="button" data-action="tab-close-others" hidden title="关闭该域名下其他标签页" aria-label="关闭该域名下其他标签页">${ICON.others}</button>
      <button class="bm-op bm-op--icon bm-op--del tab-op" type="button" data-action="tab-close-one" title="关闭这个标签页" aria-label="关闭这个标签页">${ICON.close}</button>
    `;
    for (const btn of ops.querySelectorAll('button')) btn.dataset.id = String(item.tabId);
    // 特殊桶不给「关闭其他」，避免绕过「该桶不可整组关闭」的口径。
    const othersBtn = ops.querySelector('[data-action="tab-close-others"]');
    othersBtn.hidden = group.isSpecial;
    othersBtn.disabled = state.busy;
    ops.querySelector('[data-action="tab-close-one"]').disabled = state.busy;

    li.append(focus, ops);
    frag.append(li);
  }
  list.replaceChildren(frag);
}

// ---- 瀑布流（v1.5.4）--------------------------------------------------
// 卡片不再折叠，高度差异很大，等高网格会留大片空白。CSS 多列看着像瀑布流，
// 但它只能「填满一列再下一列」、不会回填更矮的列，实测最左列会空两百多像素，
// 所以这里自己按实测高度做贪心分配：每张卡都塞进当前最矮的那一列。
const FLOW_MIN = 288; // 与 .grid 的 minmax(280px, 1fr) 同一量级
const FLOW_GAP = 16;  // 与 CSS 的 gap 保持一致
const FLOW_NARROW = 640;

function flowColumnCount(width) {
  if (!width) return 1;
  if (width <= FLOW_NARROW) return 1;
  return Math.max(1, Math.floor((width + FLOW_GAP) / (FLOW_MIN + FLOW_GAP)));
}

// 列数不变时复用已有列容器，避免每次 render 都重建 DOM（会打断 hover / focus）。
function flowColumns(count) {
  const cols = [...gridEl.children].filter((el) => el.classList.contains('masonry-col'));
  if (cols.length === count) return cols;
  const next = Array.from({ length: count }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    return col;
  });
  gridEl.replaceChildren(...next);
  return next;
}

function flowCards(groups) {
  const width = gridEl.clientWidth;
  if (!width) return; // 隐藏状态下量不到宽度，等可见时的那次 render 再排
  const cols = flowColumns(flowColumnCount(width));
  const cards = [];
  for (const group of groups) {
    const el = cardEls.get(group.key);
    if (el) cards.push(el);
  }
  // 先把卡片全塞进第一列量一遍：列宽在分配前后是一样的，高度可信；
  // 这样读高度只触发一次重排（读写分离），而不是每张卡各触发一次。
  for (const el of cards) cols[0].appendChild(el);
  const heights = cards.map((el) => el.offsetHeight + FLOW_GAP);
  const colHeights = cols.map(() => 0);
  cards.forEach((el, i) => {
    let target = 0;
    for (let c = 1; c < colHeights.length; c += 1) {
      if (colHeights[c] < colHeights[target]) target = c;
    }
    cols[target].appendChild(el);
    colHeights[target] += heights[i];
  });
}

// 窗口尺寸变化会改变列数与卡片换行，需要重排；rAF 合帧，避免拖动窗口时抖动。
let flowFrame = 0;
window.addEventListener('resize', () => {
  if (!state.active) return;
  cancelAnimationFrame(flowFrame);
  flowFrame = requestAnimationFrame(() => {
    if (state.active) flowCards(buildGroups(state.items, state.query));
  });
});

function render() {
  if (!state.active) return;
  const groups = buildGroups(state.items, state.query);
  const multiWindow = new Set(state.items.map((i) => i.windowId)).size > 1;

  const wanted = new Set(groups.map((group) => group.key));
  for (const [key, el] of cardEls) {
    if (!wanted.has(key)) { el.remove(); cardEls.delete(key); }
  }
  for (const group of groups) {
    let el = cardEls.get(group.key);
    if (!el) {
      el = createCard(group);
      cardEls.set(group.key, el);
    }
    updateCard(el, group, multiWindow);
  }
  flowCards(groups);

  emptyEl.hidden = groups.length > 0;
  if (!groups.length) {
    emptyEl.textContent = state.query
      ? `没有找到与「${state.query}」相关的标签页`
      : '当前没有可展示的标签页';
  }
  const total = state.items.length;
  const sites = groups.filter((group) => !group.isSpecial).length;
  countEl.textContent = `${total} 个标签页 · ${sites} 个站点`;
  statusEl.textContent = state.query
    ? `命中 ${total ? groups.reduce((n, group) => n + group.count, 0) : 0} / ${total} 个标签页 · 纯内存过滤`
    : `共 ${total} 个标签页 · ${sites} 个站点 · 数据来自浏览器当前打开的页面`;
}

async function reload() {
  const g = ++state.loadGen;
  state.busy = true;
  try {
    const raw = await chrome.tabs.query({});
    if (g !== state.loadGen || !state.active) return;
    state.items = normalizeTabs(raw, selfOrigin);
    render();
  } catch (err) {
    console.warn('[tabs] query failed', err);
    if (g === state.loadGen && state.active) {
      statusEl.textContent = '读取标签页失败，请确认已授予标签权限并刷新扩展';
    }
  } finally {
    if (g === state.loadGen) {
      state.busy = false;
      // render() 在 busy=true 时把关闭按钮置灰，读完必须再渲染一次恢复可点。
      render();
    }
  }
}

async function focusTab(id) {
  try {
    const tab = await chrome.tabs.get(id);
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (err) {
    console.warn('[tabs] focus failed', err);
    toast('该标签页已关闭，列表已刷新');
    await reload();
  }
}

viewEl.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!target || !state.active) return;
  const { action, id } = target.dataset;
  // 按钮自己没挂 key 时从所属卡片兜底，避免再出现「点了没反应」。
  const key = pickActionKey(target.dataset.key, target.closest('.card')?.dataset.key);
  if (action === 'tabs-refresh') {
    reload();
    return;
  }
  if (action === 'tab-focus') {
    e.preventDefault();
    focusTab(Number(id));
    return;
  }
  if (action === 'tabs-close-group' && key) {
    e.preventDefault();
    closeGroup(key);
    return;
  }
  if (action === 'tab-close-others') {
    e.preventDefault();
    closeOthers(Number(id));
    return;
  }
  if (action === 'tab-close-one') {
    e.preventDefault();
    closeSingle(Number(id));
    return;
  }
});

// 三条写路径共用同一条执行链路：按最新标签列表重算目标，关闭 → 重读 → toast。
// 先 query 再算 id，避免渲染时的陈旧 id 误关别的页面。
async function applyClose(selectTarget, emptyText) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const fresh = normalizeTabs(await chrome.tabs.query({}), selfOrigin);
    const target = selectTarget(fresh);
    if (!target.count) {
      toast(emptyText);
      await reload();
      return;
    }
    await chrome.tabs.remove(target.ids);
    toast(closeToast(target));
    await reload();
  } catch (err) {
    console.warn('[tabs] close failed', err);
    toast(`关闭失败：${String((err && err.message) || err)}`);
    await reload();
  } finally {
    state.busy = false;
    render();
  }
}

// v1.5.3 起三条路径都是**一次点击即执行**：批量关闭再套一层确认条，
// 每次都要点两下才生效，日常高频操作里比误关更烦。误关可逆靠 toast 提示的
// Ctrl+Shift+T，且关闭前会用最新标签列表重算，绝不会按陈旧 id 关错页面。
function closeGroup(key) {
  return applyClose(
    (fresh) => computeRemoveTargets(fresh, { mode: CLOSE_MODE.GROUP, key }),
    '这里没有可关闭的标签页',
  );
}

function closeOthers(tabId) {
  return applyClose(
    (fresh) => computeRemoveTargets(fresh, { mode: CLOSE_MODE.OTHERS, tabId }),
    '这些标签页已经关闭了',
  );
}

// 单条关闭可逆，一次点击即执行。
function closeSingle(tabId) {
  return applyClose(
    (fresh) => computeRemoveTargets(fresh, { mode: CLOSE_MODE.SINGLE, tabId }),
    '该标签页已经关闭了',
  );
}

export async function activate(query) {
  state.active = true;
  state.query = String(query || '');
  viewEl.hidden = false;
  qEl.placeholder = '搜索标签页标题、网址或域名';
  await reload();
}

export function deactivate() {
  state.active = false;
  state.loadGen += 1;
  state.busy = false;
  viewEl.hidden = true;
}

export async function onVisibility() {
  if (state.active) await reload();
}

export function onQuery(query) {
  if (!state.active) return;
  state.query = String(query || '');
  render();
}

export function isBusy() {
  // 写操作在途时禁止切走 tab（关标签会连带重读面板，切走会读到半途状态）。
  return state.busy;
}
