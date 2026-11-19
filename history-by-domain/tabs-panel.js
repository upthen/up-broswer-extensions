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
const PREVIEW = 3;

const state = {
  active: false,
  items: [],
  query: '',
  expanded: new Set(),
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
  chevron: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 10.9 3.5 6.4l1.1-1.1L8 8.7l3.4-3.4 1.1 1.1z" fill="currentColor"/></svg>',
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
    <button class="more" type="button" data-action="tabs-expand" aria-expanded="false" hidden>${ICON.chevron}<span class="more-label"></span></button>
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

  const expanded = state.expanded.has(group.key);
  const more = el.querySelector('.more');
  more.hidden = group.count <= PREVIEW;
  // 事件委托靠 dataset.key 找卡片；漏挂这一行会让「展开全部」点了完全没反应。
  more.dataset.key = group.key;
  more.classList.toggle('is-open', expanded);
  more.setAttribute('aria-expanded', String(expanded));
  more.querySelector('.more-label').textContent = expanded ? '收起' : `展开全部 ${group.count} 个`;

  const list = el.querySelector('.pages');
  const shown = expanded ? group.tabs : group.tabs.slice(0, PREVIEW);
  const frag = document.createDocumentFragment();
  for (const item of shown) {
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
    gridEl.appendChild(el);
  }

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
  if (action === 'tabs-expand' && key) {
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    render();
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
