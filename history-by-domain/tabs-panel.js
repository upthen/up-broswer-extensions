// 标签页 tab 视图层（SPEC v1.4.0）：只读标签元数据、按域名成卡、点击聚焦。
// 与 app.js 的历史侧刻意隔离：模块只在切到「标签页」时动态加载，
// 只在激活且可见时读取，不注册任何 chrome.tabs 事件监听，不写任何存储。

import { normalizeTabs, buildGroups, LOCAL_BUCKET } from './tabs.js';

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
  renderGen: 0,
  toastTimer: 0,
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
};

function createCard(group) {
  const el = document.createElement('article');
  el.className = 'card card--tabs';
  el.dataset.key = group.key;
  el.innerHTML = `
    <div class="card-head">
      <div class="fav"><img alt="" width="24" height="24" /><span class="fav-fallback"></span></div>
      <div class="meta"><div class="domain"></div><div class="stat"></div></div>
      <div class="card-tools">
        <button class="tabs-close-all" type="button" data-action="tabs-close-group" hidden>全部关闭</button>
      </div>
    </div>
    <div class="del-bar" hidden>
      <div class="del-text"></div>
      <div class="del-actions">
        <button class="del-cancel" type="button" data-action="tabs-cancel">取消</button>
        <button class="del-go" type="button" data-action="tabs-confirm">关闭标签页</button>
      </div>
    </div>
    <ul class="pages"></ul>
    <button class="more" type="button" data-action="tabs-expand" hidden></button>
  `;
  const fallback = el.querySelector('.fav-fallback');
  fallback.textContent = (group.label || '?').charAt(0).toUpperCase();
  return el;
}

function rowMeta(item, group, multiWindow) {
  const bits = [];
  if (item.isSpecial) bits.push('本地 / 其他');
  else bits.push(item.host || item.regDomain);
  if (multiWindow) bits.push(`窗口 ${item.windowId}`);
  if (item.pinned) bits.push('已固定');
  if (item.isDuplicate) bits.push('重复');
  return bits.join(' · ');
}

function updateCard(el, group, multiWindow) {
  el.querySelector('.domain').textContent = group.label;
  el.querySelector('.stat').textContent = `${group.count} 个标签页`;
  el.classList.toggle('card--special', group.isSpecial);

  const expanded = state.expanded.has(group.key);
  const more = el.querySelector('.more');
  more.hidden = group.count <= PREVIEW;
  more.textContent = expanded ? '收起' : `展开全部 ${group.count} 个`;

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
    meta.textContent = rowMeta(item, group, multiWindow);
    focus.append(title, meta);

    const ops = document.createElement('span');
    ops.className = 'tab-ops';
    ops.innerHTML = `
      <button class="bm-op bm-op--icon tab-op" type="button" data-action="tab-close-others" hidden title="关闭该域名下其他标签页" aria-label="关闭该域名下其他标签页">${ICON.others}</button>
      <button class="bm-op bm-op--icon bm-op--del tab-op" type="button" data-action="tab-close-one" hidden title="关闭这个标签页" aria-label="关闭这个标签页">${ICON.close}</button>
    `;
    for (const btn of ops.querySelectorAll('button')) btn.dataset.id = String(item.tabId);

    li.append(focus, ops);
    frag.append(li);
  }
  list.replaceChildren(frag);
}

function render() {
  if (!state.active) return;
  const g = ++state.renderGen;
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
  const domains = groups.filter((group) => !group.isSpecial).length;
  countEl.textContent = `${total} 个标签页 · ${domains} 个域名`;
  statusEl.textContent = state.query
    ? `命中 ${total ? groups.reduce((n, group) => n + group.count, 0) : 0} / ${total} 个标签页 · 纯内存过滤`
    : `共 ${total} 个标签页 · ${domains} 个域名 · 数据来自浏览器当前打开的页面`;
  void g;
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
    if (g === state.loadGen) state.busy = false;
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
  const { action, id, key } = target.dataset;
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
  }
});

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
  return state.busy;
}

export { toast, render, reload, LOCAL_BUCKET };
