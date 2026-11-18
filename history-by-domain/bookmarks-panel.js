// 书签 tab 视图层（SPEC v1.3.0 §16.4–16.8，展示模型由 §16.13 修订为「文件夹卡片墙」）。
// 与 app.js 的历史侧刻意隔离：本模块只管 #bookmarkView 与全局浮层，
// app.js 只负责 activeTab 切换、搜索框分流与历史侧原有逻辑（零回归）。
// 所有动态文本一律 escapeHtml / highlight 后再进 innerHTML。

import {
  readAll, aggregateFolders, subtreePages, folderPathOf, filterBookmarks, countSubtree,
  createBookmark, createFolder, rename, move, removeBookmark, removeTree,
} from './bookmarks.js';
import { escapeHtml, highlight, splitWords } from './search.js';
import { renderRows } from './scope-view.js';

const $ = (s) => document.querySelector(s);
const viewEl = $('#bookmarkView');
const qEl = $('#q');
const statusEl = $('#status');
const gridEl = $('#bmGrid');
const emptyEl = $('#bmEmpty');
const countEl = $('#bmCount');
const scopeBarEl = $('#bmScopeBar');
const scopeNameEl = $('#bmScopeName');
const scopeViewEl = $('#bmScopeView');
const scopeListEl = $('#bmScopeList');
const scopeEmptyEl = $('#bmScopeEmpty');
const overlayEl = $('#bmOverlay');
const dialogEl = $('#bmDialog');
const toastEl = $('#bmToast');

const INLINE_LIMIT = 10;

const state = {
  active: false,
  data: null,
  query: '',
  scopeKey: null,       // 文件夹作用域：存 folderId（§16.13）
  busy: false,
  pendingDelete: null,  // { id, title, folder, counts, phase }
  dialog: null,         // { type:'tree'|'form'|'pick', kind?, id?, parentId?, targetId?, back? }
  expanded: new Set(),
  toastTimer: 0,
};
let loadGen = 0;
let renderGen = 0;

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const esc = escapeHtml;

const FOLDER_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M1.5 4.2c0-.7.6-1.2 1.3-1.2h3.1l1.4 1.5h5.4c.7 0 1.3.5 1.3 1.2v6.9c0 .7-.6 1.2-1.3 1.2H2.8c-.7 0-1.3-.5-1.3-1.2V4.2zm1.2.5v6.9c0 .1.1.2.2.2h10.2c.1 0 .2-.1.2-.2V5.7c0-.1-.1-.2-.2-.2H7l-1.4-1.5H2.9c-.1 0-.2.1-.2.2z" fill="currentColor"/></svg>';

// 行级 / 卡片头写操作按钮统一用图标（用户反馈文字按钮太占位置），文案放 title + aria-label。
const ICON = {
  rename: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11.9 1.7a1.7 1.7 0 0 1 2.4 2.4L5.6 12.8l-3.4.9.9-3.4 8.8-8.6zm1.7 1.4a.6.6 0 0 0-.9 0l-8 7.9-.4 1.5 1.5-.4 8-7.9a.6.6 0 0 0 0-.9z" fill="currentColor"/></svg>',
  move: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.7 11.5 5 10.4 6.1 8.7 4.4v6.9H7.2V4.4L5.5 6.1 4.4 5 8 1.7zM2.5 9.5h1.5v3.3c0 .2.1.3.3.3h7.4c.2 0 .3-.1.3-.3V9.5h1.5v3.3c0 1-.8 1.8-1.8 1.8H4.3c-1 0-1.8-.8-1.8-1.8V9.5z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.2 1.5h3.6l.5 1.4h2.9v1.4H2.8V2.9h2.9l.5-1.4zM4.4 5.8h7.2l-.7 8.2H5.1l-.7-8.2zm1.6 1.5.4 5.2h1.1l-.4-5.2H6zm2.9 0-.4 5.2h1.1l.4-5.2H8.9z" fill="currentColor"/></svg>',
  addFolder: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 4.2c0-.7.6-1.2 1.3-1.2h3.1l1.4 1.5h5.4c.7 0 1.3.5 1.3 1.2v2.1h-1.5V5.7c0-.1-.1-.2-.2-.2H7l-1.4-1.5H2.9c-.1 0-.2.1-.2.2v6.9c0 .1.1.2.2.2h4.1V13H2.8c-.7 0-1.3-.5-1.3-1.2V4.2zM12 8h1.5v2H15.5v1.5h-2V13.5H12v-2H9.5V10H12V8z" fill="currentColor"/></svg>',
};
const iconOp = (action, label, icon, attrs, extraClass = '') =>
  `<button type="button" class="bm-op bm-op--icon ${extraClass}" data-action="${action}" title="${label}" aria-label="${label}"${attrs}>${icon}</button>`;

function relTime(ts) {
  if (!ts) return '时间未知';
  const d = Date.now() - ts;
  if (d < 0 || d < 60_000) return '刚刚';
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

// 作用域 chip / 状态行用的文件夹名：完整路径，例如「书签栏 / 开发 / 文档」。
function scopeLabel() {
  if (!state.scopeKey || !state.data) return '';
  const path = folderPathOf(state.data, state.scopeKey);
  return path.length ? path.join(' / ') : '未命名文件夹';
}

function openPage(url) {
  if (!url) return;
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // 安全约束 2
  chrome.tabs.create({ url: u.href });
}

// §16.13：详情页按文件夹打开（folder=<id>）；仍带 q 以便在新页保留关键词。
function openDetail(folderId, q) {
  if (!folderId) return;
  const u = new URL(chrome.runtime.getURL('detail.html'));
  u.searchParams.set('source', 'bookmarks');
  u.searchParams.set('folder', folderId);
  if (q && q.trim()) u.searchParams.set('q', q.trim());
  chrome.tabs.create({ url: u.toString() });
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

function closeDialog() {
  state.dialog = null;
  overlayEl.hidden = true;
  dialogEl.replaceChildren();
}

// ---- 数据：全量重读为唯一真值，不缓存、不监听 ----
async function reload() {
  const g = ++loadGen;
  let data;
  try {
    data = await readAll();
  } catch (err) {
    console.warn('[bookmarks] getTree 失败', err);
    if (g === loadGen && state.active) {
      statusEl.textContent = '读取书签失败，请确认已授予「读取和更改您的书签」权限并刷新扩展';
      countEl.textContent = '';
      gridEl.replaceChildren();
      scopeListEl.replaceChildren();
      emptyEl.hidden = false;
      emptyEl.textContent = '无法读取浏览器书签。请到扩展管理页刷新本扩展后重试。';
    }
    return false;
  }
  if (g !== loadGen || !state.active) return false;
  state.data = data;
  return true;
}

async function applyWrite(fn, okText, keepDialog) {
  try {
    state.busy = true;
    await fn();
    await reload();          // 写成功后立即重读，UI 以浏览器真值为准
    await render();
    toast(okText);
    if (!keepDialog) closeDialog();
    else renderDialog();
    return true;
  } catch (err) {
    console.warn('[bookmarks]', err);
    toast(`操作失败：${String((err && err.message) || err)}`);
    return false;
  } finally {
    state.busy = false;
  }
}

/** 写完表单后按来源回到卡片墙或树弹层（树里操作保持弹层打开，见 §16.6）。 */
function afterFolderWrite(back) {
  if (back === 'tree') {
    state.dialog = { type: 'tree' };
    renderDialog();
  } else {
    closeDialog();
  }
}

// ---- 渲染 ----
function confirmHtml(pd) {
  if (pd.phase === 'scan') {
    return `<div class="del-bar"><div class="del-text">正在统计「${esc(pd.title)}」的范围…</div></div>`;
  }
  const c = pd.counts || { folders: 0, bookmarks: 0 };
  const scope = pd.folder ? `（含 ${c.folders} 个子文件夹 / ${c.bookmarks} 个书签）` : '';
  return `<div class="del-bar is-danger">
    <div class="del-text">将删除「${esc(pd.title)}」${scope}，此操作不可撤销。</div>
    <div class="del-actions">
      <button type="button" class="del-cancel" data-action="bm-delete-cancel">取消</button>
      <button type="button" class="del-go" data-action="bm-delete-confirm">确认删除</button>
    </div>
  </div>`;
}

// 行内第二行改显示域名：文件夹信息已经在卡片头，避免重复（§16.13.1）。
function rowHtml(p, words) {
  const pending = state.pendingDelete && state.pendingDelete.id === p.id;
  const crumb = p.isSpecial ? '本地 / 其他 · 只展示不打开' : (p.host || p.regDomain || '');
  // 受管书签（unmodifiable: "managed"）一律不可写：三个写入口都置灰。
  // title 由 iconOp 统一给（图标按钮靠 title/aria-label 表达语义），这里只保留 disabled。
  const lock = p.locked ? ' disabled' : '';
  return `<li class="bm-row" data-id="${esc(p.id)}">
    <div class="bm-line">
      <a class="page-link" href="#" data-action="bm-open" data-url="${esc(p.url)}" title="${esc(p.title || fallbackTitle(p))}&#10;${esc(p.url)}">
        <span class="p-title">${highlight(p.title || fallbackTitle(p), words)}</span>
        <span class="p-time">添加于 ${relTime(p.dateAdded)}</span>
      </a>
      <div class="bm-row-ops">
        ${iconOp('bm-rename', '改名', ICON.rename, ` data-id="${esc(p.id)}"${lock}`)}
        ${iconOp('bm-move', '移动到…', ICON.move, ` data-id="${esc(p.id)}"${lock}`)}
        ${iconOp('bm-delete-ask', '删除', ICON.trash, ` data-id="${esc(p.id)}"${lock}`, 'bm-op--del')}
      </div>
    </div>
    <div class="bm-crumb">${crumb ? highlight(crumb, words) : '未分类'}</div>
    ${pending ? confirmHtml(state.pendingDelete) : ''}
  </li>`;
}

// 文件夹卡片头：改名 / + 子文件夹 / 删除；内置锁定节点禁用改名与删除。
function folderOpsHtml(card) {
  if (card.isVirtual) return '';
  const lock = card.locked ? ' disabled' : '';
  return `<div class="bm-folder-ops">
    ${iconOp('bm-folder-rename', '改名', ICON.rename, ` data-fid="${esc(card.id)}"${lock}`)}
    ${iconOp('bm-folder-new', '新建子文件夹', ICON.addFolder, ` data-fid="${esc(card.id)}"`)}
    ${iconOp('bm-folder-delete', '删除文件夹', ICON.trash, ` data-fid="${esc(card.id)}"${lock}`, 'bm-op--del')}
  </div>`;
}

function subfoldersHtml(card) {
  if (!card.subfolders.length) return '';
  const chips = card.subfolders.map((s) =>
    `<button type="button" class="bm-sub" data-action="bm-subfolder" data-fid="${esc(s.id)}" title="进入「${esc(s.label)}」">${FOLDER_ICON}<span>${esc(s.label)}</span><i>${s.count}</i></button>`,
  ).join('');
  return `<div class="bm-subs"><span class="bm-subs-label">子文件夹</span>${chips}</div>`;
}

function cardHtml(card, words) {
  const total = card.pages.length;
  const expanded = state.expanded.has(card.key) && total <= INLINE_LIMIT;
  const shown = expanded ? card.pages : card.pages.slice(0, 3);
  const pathText = card.path.join(' / ');
  const stat = `${card.pageCount} 个书签${card.subfolderCount ? ` · ${card.subfolderCount} 个子文件夹` : ''}`;
  const pending = state.pendingDelete && state.pendingDelete.id === card.key;

  let more = '';
  if (total > INLINE_LIMIT) {
    more = `<button class="more" type="button" data-action="bm-open-detail" data-key="${esc(card.key)}" data-q="${esc(state.query)}">在新页查看全部 ${total} 个书签 ↗</button>`;
  } else if (total > 3) {
    more = `<button class="more" type="button" data-action="bm-expand" data-key="${esc(card.key)}">${expanded ? '收起' : `查看全部 ${total} 个书签`}</button>`;
  }

  const scopeBtn = card.isVirtual ? '' :
    `<button class="card-scope" type="button" title="仅在此文件夹内搜索书签（含所有子文件夹）" aria-label="仅在此文件夹内搜索书签" data-action="bm-scope-enter" data-key="${esc(card.key)}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.8 2a4.8 4.8 0 1 0 3 8.5l3.35 3.35 1.05-1.05-3.35-3.35A4.8 4.8 0 0 0 6.8 2zm0 1.6a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" fill="currentColor"/></svg></button>`;

  const emptyHint = card.isEmpty
    ? `<div class="bm-card-empty">此文件夹暂无书签${card.isVirtual ? '' : `<button type="button" class="bm-op" data-action="bm-folder-new" data-fid="${esc(card.id)}">+ 新建子文件夹</button>`}</div>`
    : '';

  return `<article class="card card--bm" data-key="${esc(card.key)}">
    <div class="card-head">
      <div class="fav fav--folder">${FOLDER_ICON}</div>
      <div class="meta">
        <div class="domain" title="${esc(card.label)}">${highlight(card.label, words)}</div>
        <div class="stat">${stat}</div>
      </div>
      <div class="card-tools">${scopeBtn}${folderOpsHtml(card)}</div>
    </div>
    <div class="bm-card-path">${highlight(pathText, words)}</div>
    ${pending ? confirmHtml(state.pendingDelete) : ''}
    ${emptyHint}
    ${shown.length ? `<ul class="pages">${shown.map((p) => rowHtml(p, words)).join('')}</ul>` : ''}
    ${more}
    ${subfoldersHtml(card)}
  </article>`;
}

async function render() {
  if (!state.active || !state.data) return;
  const g = ++renderGen;
  const words = splitWords(state.query);
  const all = state.data.pages;
  const searching = !!state.query.trim();
  // §16.13.2：文件夹作用域的候选 = 该文件夹及所有子文件夹的书签。
  const inScope = state.scopeKey ? subtreePages(state.data, state.scopeKey) : all;
  const rows = filterBookmarks(inScope, state.query);

  scopeBarEl.hidden = !state.scopeKey;
  if (state.scopeKey) scopeNameEl.textContent = scopeLabel();

  if (state.scopeKey) {
    statusEl.textContent = `仅在文件夹「${scopeLabel()}」内 · 命中 ${rows.length} / ${inScope.length} 个书签 · 含所有子文件夹`;
  } else if (searching) {
    statusEl.textContent = `命中 ${rows.length} / ${all.length} 个书签 · 搜索范围：浏览器全部书签`;
  } else {
    const folderCount = aggregateFolders(state.data, all, true).length;
    statusEl.textContent = `共 ${folderCount} 个文件夹 · ${all.length} 个书签 · 按书签文件夹排列 · 数据来自浏览器书签`;
  }
  countEl.textContent = `共 ${all.length} 个书签`;
  qEl.placeholder = state.scopeKey
    ? `在「${scopeLabel()}」内搜索书签`
    : '搜索书签标题、网址或文件夹';

  if (state.scopeKey) {
    gridEl.hidden = true;
    emptyEl.hidden = true;
    scopeViewEl.hidden = false;
    scopeEmptyEl.hidden = rows.length > 0;
    if (!rows.length) {
      scopeEmptyEl.textContent = searching
        ? `在「${scopeLabel()}」内没有找到与「${state.query}」相关的书签`
        : '该文件夹下没有可展示的书签';
    }
    await renderRows(scopeListEl, rows, words, () => g !== renderGen, { bookmarks: true });
    return;
  }

  scopeViewEl.hidden = true;
  gridEl.hidden = false;
  // 首屏输出全部文件夹（含空文件夹）；搜索态只输出命中的卡片，卡片内只显示命中行。
  const cards = aggregateFolders(state.data, searching ? rows : all, !searching);
  emptyEl.hidden = cards.length > 0;
  if (!cards.length) {
    emptyEl.textContent = searching
      ? `没有找到与「${state.query}」相关的书签`
      : '浏览器书签库里还没有可展示的文件夹';
  }
  gridEl.innerHTML = cards.map((c) => cardHtml(c, words)).join('');
}

// ---- 浮层：文件夹树 / 表单 / 目标选择 ----
function folderOptions(selected) {
  if (!state.data) return '';
  return state.data.folders
    .filter((f) => f.id !== '0')
    .map((f) => {
      const label = folderPathOf(state.data, f.id).join(' / ');
      return `<option value="${esc(f.id)}"${selected === f.id ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

function treeHtml(d, pickMode) {
  const folders = (state.data && state.data.folders || []).filter((f) => f.id !== '0');
  const rows = folders.map((f) => {
    const depth = (f.folderPath || []).length;
    const locked = f.locked;
    const empty = !f.children || f.children.length === 0;
    const ops = pickMode
      ? `<button type="button" class="tree-op" data-action="bm-pick-folder" data-fid="${esc(f.id)}">选为目标</button>`
      : `<button type="button" class="tree-op" data-action="bm-tree-rename" data-fid="${esc(f.id)}"${locked ? ' disabled' : ''}>改名</button>
         <button type="button" class="tree-op" data-action="bm-tree-new" data-fid="${esc(f.id)}">+ 子文件夹</button>
         <button type="button" class="tree-op" data-action="bm-tree-move" data-fid="${esc(f.id)}"${locked ? ' disabled' : ''}>移动</button>
         <button type="button" class="tree-op is-del" data-action="bm-tree-delete" data-fid="${esc(f.id)}"${locked ? ' disabled' : ''}>删除</button>`;
    const tag = locked
      ? '<span class="tag-lock">内置 · 锁定</span>'
      : f.folderType === 'mobile' ? '<span class="tag-lock">内置 · 可改</span>'
        : empty ? '<span class="tag-empty">空文件夹 · 仍可见</span>'
          : `<span class="cnt">${f.children.length} 项</span>`;
    return `<div class="tree-node" style="padding-left:${10 + depth * 18}px" data-fid="${esc(f.id)}">
      <span class="tree-name">${esc(f.title || '未命名')}</span>${tag}
      <div class="tree-ops">${ops}</div>
    </div>`;
  }).join('');
  const pending = state.pendingDelete && state.pendingDelete.phase === 'confirm';
  return `<div class="dialog-head"><h3>${pickMode ? '选择目标文件夹' : '文件夹'}</h3>
      <button type="button" class="dialog-x" data-action="bm-dialog-close" aria-label="关闭">×</button></div>
    <p class="dialog-sub">${pickMode
      ? '选中一个文件夹作为「移动到…」的目标。'
      : '空文件夹在卡片墙与这里都可见；「书签栏 / 其他书签」不可改名、移动、删除，但在其下新建子项是允许的；「移动端书签」可正常修改。'}</p>
    <div class="tree-body">${rows || '<p class="dialog-sub">还没有文件夹。</p>'}</div>
    ${pending ? confirmHtml(state.pendingDelete) : ''}
    <div class="dialog-foot">${pickMode ? '' : '<button type="button" class="btn" data-action="bm-new-folder" data-back="tree">+ 新建文件夹</button>'}</div>`;
}

function formHtml(d) {
  const titles = {
    'new-bookmark': '新建书签', 'new-folder': '新建文件夹',
    rename: '改名', 'rename-folder': '改名文件夹',
  };
  let fields = '';
  if (d.kind === 'new-bookmark') {
    fields = `<label>标题<input name="title" type="text" required autocomplete="off" placeholder="例如：Web APIs 参考手册" /></label>
      <label>网址<input name="url" type="text" required autocomplete="off" placeholder="https://example.com/page" /></label>
      <label>保存到<select name="parentId">${folderOptions(d.parentId)}</select></label>`;
  } else if (d.kind === 'new-folder') {
    fields = `<label>名称<input name="title" type="text" required autocomplete="off" placeholder="例如：设计参考" /></label>
      <label>位置<select name="parentId">${folderOptions(d.parentId)}</select></label>`;
  } else {
    fields = `<label>新名称<input name="title" type="text" required autocomplete="off" value="${esc(d.title || '')}" /></label>`;
  }
  return `<div class="dialog-head"><h3>${titles[d.kind] || '编辑'}</h3>
      <button type="button" class="dialog-x" data-action="bm-dialog-close" aria-label="关闭">×</button></div>
    <form id="bmForm" class="dialog-form" data-kind="${esc(d.kind)}" data-id="${esc(d.id || '')}">
      ${fields}
      <div class="dialog-foot">
        <button type="button" class="btn" data-action="bm-dialog-close">取消</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>`;
}

function renderDialog() {
  const d = state.dialog;
  if (!d) { closeDialog(); return; }
  overlayEl.hidden = false;
  dialogEl.innerHTML = d.type === 'tree' ? treeHtml(d, false)
    : d.type === 'pick' ? treeHtml(d, true)
      : formHtml(d);
  const first = dialogEl.querySelector('input');
  if (first) first.focus();
}

// ---- 两步确认 ----
async function askDelete(id) {
  if (!state.data) return;
  const node = state.data.byId.get(id);
  if (!node || node.locked) return;
  state.pendingDelete = { id, title: node.title || '未命名', folder: !!node.isFolder, counts: null, phase: 'scan' };
  render();
  renderDialog();
  await nextFrame();
  if (!state.active || !state.pendingDelete || state.pendingDelete.id !== id) return;
  state.pendingDelete.counts = countSubtree(node); // 纯只读统计，确认前 0 次写调用
  state.pendingDelete.phase = 'confirm';
  render();
  renderDialog();
}

function cancelDelete() {
  state.pendingDelete = null;
  render();
  renderDialog();
}

async function confirmDelete() {
  const pd = state.pendingDelete;
  if (!pd || pd.phase !== 'confirm') return;
  state.pendingDelete = null;
  const ok = await applyWrite(
    () => (pd.folder ? removeTree(pd.id) : removeBookmark(pd.id)),
    `已删除「${pd.title}」`,
    false,
  );
  if (!ok) { await render(); }
}

// ---- 表单提交 ----
async function submitForm(form) {
  const d = state.dialog;
  if (!d) return;
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  const kind = form.dataset.kind;
  const id = form.dataset.id;
  const back = d.back || 'wall';
  if (!title) { toast('名称不能为空'); return; }

  if (kind === 'new-bookmark') {
    const raw = String(fd.get('url') || '').trim();
    let u;
    try { u = new URL(raw); } catch { toast('网址格式不对'); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { toast('网址只允许 http / https'); return; }
    await applyWrite(() => createBookmark({ parentId: String(fd.get('parentId') || ''), title, url: u.href }),
      `已新建书签「${title}」`, false);
  } else if (kind === 'new-folder') {
    await applyWrite(() => createFolder({ parentId: String(fd.get('parentId') || ''), title }),
      `已新建文件夹「${title}」`, false);
    afterFolderWrite(back);
  } else if (kind === 'rename') {
    await applyWrite(() => rename(id, title), `已改名为「${title}」`, false);
  } else if (kind === 'rename-folder') {
    await applyWrite(() => rename(id, title), `已改名为「${title}」`, false);
    afterFolderWrite(back);
  }
}

// ---- 事件委托 ----
function handleAction(e) {
  const el = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!el || !state.active) return false;
  const a = el.dataset.action;
  if (!a.startsWith('bm-')) return false;

  switch (a) {
    case 'bm-open': {
      e.preventDefault();
      openPage(el.dataset.url);
      break;
    }
    case 'bm-scope-enter':
      state.scopeKey = el.dataset.key || null;
      render();
      break;
    case 'bm-subfolder':
      state.scopeKey = el.dataset.fid || null;
      render();
      break;
    case 'bm-scope-exit':
    case 'bm-scope-close':
      state.scopeKey = null;
      render();
      break;
    case 'bm-scope-open-detail':
      openDetail(state.scopeKey, state.query);
      break;
    case 'bm-open-detail':
      openDetail(el.dataset.key, el.dataset.q || '');
      break;
    case 'bm-expand': {
      const k = el.dataset.key;
      if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k);
      render();
      break;
    }
    case 'bm-new-bookmark':
      state.dialog = { type: 'form', kind: 'new-bookmark' };
      renderDialog();
      break;
    case 'bm-new-folder':
      // 顶部工具栏 -> 写完回卡片墙；树弹层里的按钮带 data-back="tree" -> 写完回树。
      state.dialog = { type: 'form', kind: 'new-folder', parentId: el.dataset.fid || '', back: el.dataset.back || 'wall' };
      renderDialog();
      break;
    case 'bm-folder-new':
      state.dialog = { type: 'form', kind: 'new-folder', parentId: el.dataset.fid || '', back: 'wall' };
      renderDialog();
      break;
    case 'bm-folders':
      state.dialog = { type: 'tree' };
      renderDialog();
      break;
    case 'bm-rename': {
      const node = state.data && state.data.byId.get(el.dataset.id);
      state.dialog = { type: 'form', kind: 'rename', id: el.dataset.id, title: node ? node.title : '' };
      renderDialog();
      break;
    }
    case 'bm-folder-rename': {
      const node = state.data && state.data.byId.get(el.dataset.fid);
      state.dialog = { type: 'form', kind: 'rename-folder', id: el.dataset.fid, title: node ? node.title : '', back: 'wall' };
      renderDialog();
      break;
    }
    case 'bm-folder-delete':
      askDelete(el.dataset.fid);
      break;
    case 'bm-tree-rename': {
      const node = state.data && state.data.byId.get(el.dataset.fid);
      state.dialog = { type: 'form', kind: 'rename-folder', id: el.dataset.fid, title: node ? node.title : '', back: 'tree' };
      renderDialog();
      break;
    }
    case 'bm-tree-new':
      state.dialog = { type: 'form', kind: 'new-folder', parentId: el.dataset.fid, back: 'tree' };
      renderDialog();
      break;
    case 'bm-move':
    case 'bm-tree-move':
      state.dialog = { type: 'pick', id: el.dataset.id || el.dataset.fid };
      renderDialog();
      break;
    case 'bm-pick-folder': {
      const targetId = el.dataset.fid;
      const id = state.dialog && state.dialog.id;
      if (!id || !targetId) return true;
      applyWrite(() => move(id, targetId), '已移动', false);
      break;
    }
    case 'bm-delete-ask':
      askDelete(el.dataset.id);
      break;
    case 'bm-tree-delete':
      askDelete(el.dataset.fid);
      break;
    case 'bm-delete-cancel':
      cancelDelete();
      break;
    case 'bm-delete-confirm':
      confirmDelete();
      break;
    case 'bm-dialog-close':
      state.pendingDelete = null;
      closeDialog();
      render();
      break;
    default:
      return false;
  }
  return true;
}

// ---- 对外接口（app.js 只调这些）----
export async function activate(queryText) {
  state.active = true;
  state.query = String(queryText || '').trim();
  viewEl.hidden = false;
  qEl.placeholder = '搜索书签标题、网址或文件夹';
  qEl.setAttribute('aria-label', '搜索书签');
  statusEl.textContent = '正在读取浏览器书签…';
  await reload();
  await render();
}

export function deactivate() {
  state.active = false;
  loadGen += 1;
  renderGen += 1;
  state.pendingDelete = null;
  state.busy = false;
  closeDialog();
  toastEl.hidden = true;
  viewEl.hidden = true;
}

export function onQuery(v) {
  if (!state.active) return;
  state.query = String(v || '').trim();
  render();
}

export function onEscape() {
  if (!state.active) return false;
  if (state.dialog) {
    state.pendingDelete = null;
    closeDialog();
    render();
    return true;
  }
  if (state.scopeKey) {
    state.scopeKey = null;
    render();
    return true;
  }
  return false;
}

export async function onVisibility() {
  if (!state.active || state.busy || state.pendingDelete) return;
  await reload();
  await render();
}

export function isBusy() {
  return state.busy || !!state.pendingDelete;
}

// 模块内注册：书签 tab 激活时才响应。
document.addEventListener('click', (e) => { handleAction(e); });
overlayEl.addEventListener('click', (e) => {
  if (e.target === overlayEl && state.active) {
    state.pendingDelete = null;
    closeDialog();
    render();
  }
});
dialogEl.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'bmForm') return;
  e.preventDefault();
  submitForm(form);
});
