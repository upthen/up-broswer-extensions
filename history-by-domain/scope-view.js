// 域内结果列表：历史作用域视图、书签作用域视图与 detail.html 详情页共用同一套行结构与分批渲染。
// v1.3.0 新增 opts.bookmarks：书签行显示「添加于 X 前」与文件夹面包屑，不显示「N 次访问」；
// 历史侧不传 opts 时行为与 v1.2.1 完全一致。本模块只碰 DOM，不调 chrome.* API。

import { highlight } from './search.js';

const BATCH = 50;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export function formatRelTime(ts) {
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

// highlight 内部先 escapeHtml 再包 <mark>，标题与 URL 都来自浏览器，可安全用于 innerHTML。
export function makeRow(p, words, opts) {
  const bm = !!(opts && opts.bookmarks);
  const li = document.createElement('li');
  li.className = 'detail-row';

  const a = document.createElement('a');
  a.className = 'detail-main';
  // 书签侧可能有 javascript: / chrome:// 等，href 统一给 '#'，真实 URL 放 data-url，
  // 点击时由调用方 preventDefault + http/https 白名单校验后新标签打开（安全约束 2）。
  a.href = bm ? '#' : p.url;
  a.dataset.action = 'open-page';
  a.dataset.url = p.url;
  a.title = p.url;

  const t = document.createElement('span');
  t.className = 'd-title';
  t.innerHTML = highlight(p.title || (p.path && p.path !== '/' ? p.path : p.url), words);

  const u = document.createElement('span');
  u.className = 'd-url';
  u.innerHTML = highlight(p.url, words);

  a.append(t, u);
  if (bm && p.folderPath && p.folderPath.length) {
    const c = document.createElement('span');
    c.className = 'd-crumb';
    c.textContent = p.folderPath.join(' / ');
    a.append(c);
  }

  const meta = document.createElement('div');
  meta.className = 'd-meta';
  const visits = document.createElement('span');
  visits.textContent = bm
    ? `添加于 ${formatRelTime(p.dateAdded || p.lastVisitTime)}`
    : `${p.visitCount || 0} 次`;
  if (bm) {
    meta.append(visits);
  } else {
    const time = document.createElement('span');
    time.textContent = formatRelTime(p.lastVisitTime);
    meta.append(visits, time);
  }

  li.append(a, meta);
  return li;
}

// 分批 append，批间让出主线程；isCancelled 用调用方的 renderGen，过期即停止。
export async function renderRows(container, pages, words, isCancelled, opts) {
  container.replaceChildren();
  const list = pages || [];
  for (let i = 0; i < list.length; i += BATCH) {
    if (isCancelled && isCancelled()) return;
    const frag = document.createDocumentFragment();
    for (const p of list.slice(i, i + BATCH)) frag.append(makeRow(p, words, opts));
    container.append(frag);
    if (i + BATCH < list.length) await nextFrame();
  }
}
