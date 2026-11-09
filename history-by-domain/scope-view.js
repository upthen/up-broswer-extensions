// 域内结果列表：主面板的「域名作用域」视图与 detail.html 详情页共用同一套行结构与分批渲染，
// 保证用户在两处看到的排序、字段、高亮完全一致。本模块只碰 DOM，不调 chrome.* API。

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

// highlight 内部先 escapeHtml 再包 <mark>，标题与 URL 都来自历史，可安全用于 innerHTML。
export function makeRow(p, words) {
  const li = document.createElement('li');
  li.className = 'detail-row';

  const a = document.createElement('a');
  a.className = 'detail-main';
  a.href = p.url; // 点击时 preventDefault + 协议白名单校验
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

  const meta = document.createElement('div');
  meta.className = 'd-meta';
  const visits = document.createElement('span');
  visits.textContent = `${p.visitCount || 0} 次`;
  const time = document.createElement('span');
  time.textContent = formatRelTime(p.lastVisitTime);
  meta.append(visits, time);

  li.append(a, meta);
  return li;
}

// 分批 append，批间让出主线程；isCancelled 用调用方的 renderGen，过期即停止。
export async function renderRows(container, pages, words, isCancelled) {
  container.replaceChildren();
  const list = pages || [];
  for (let i = 0; i < list.length; i += BATCH) {
    if (isCancelled && isCancelled()) return;
    const frag = document.createDocumentFragment();
    for (const p of list.slice(i, i + BATCH)) frag.append(makeRow(p, words));
    container.append(frag);
    if (i + BATCH < list.length) await nextFrame();
  }
}
