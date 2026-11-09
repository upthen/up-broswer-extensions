// 前端精排与高亮。
// 多词 AND 由 Chrome 原生 text 查询承担，这里只做加权排序 + 高亮，不硬过滤，
// 避免中文/分词差异把本已命中的结果误杀（见 SPEC §6.5）。

export function splitWords(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 先转义，再对转义后的文本一次性包 <mark>；输出可安全用于 innerHTML。
export function highlight(text, words) {
  const safe = escapeHtml(text);
  const patterns = (words || [])
    .map((w) => escapeRegExp(escapeHtml(w)))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!patterns.length) return safe;
  return safe.replace(new RegExp(`(${patterns.join('|')})`, 'gi'), '<mark>$1</mark>');
}

function score(p, words, now) {
  const title = (p.title || '').toLowerCase();
  const url = (p.url || '').toLowerCase();
  const hay = `${title} ${url}`;
  const domainHay = `${p.regDomain || ''} ${p.host || ''}`.toLowerCase();
  const path = (p.path || '').toLowerCase();

  let s = 0;
  if (words.some((w) => domainHay.includes(w))) s += 100;
  if (words.every((w) => hay.includes(w))) s += 60;
  if (words.some((w) => title.includes(w))) s += 40;
  if (words.some((w) => path.includes(w))) s += 10;
  const weeks = Math.max(0, Math.floor((now - (p.lastVisitTime || 0)) / (7 * 86400_000)));
  s += Math.max(0, 20 - weeks * 2);
  return s;
}

export function rank(pages, words, now = Date.now()) {
  const list = [...pages];
  if (!words.length) return list.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
  return list
    .map((p) => ({ p, s: score(p, words, now) }))
    .sort((a, b) => b.s - a.s || b.p.lastVisitTime - a.p.lastVisitTime)
    .map((x) => x.p);
}

// 域内搜索（SPEC v1.2 §6.8）：数据已由 scanHistory 把该域名 90 天记录全量枚举到内存，
// 因此这里可以做**硬过滤**，与全局搜索的"原生召回 + 软排序"路径正好相反：
//   - 全局：候选来自 history.search({text})，受 maxResults 截断与原生分词影响，硬过滤会误杀；
//   - 域内：候选完整且规模小，多词 AND、子串匹配、中文都可靠，且零额外 history 调用。
// 空 query 返回按时间降序的全部页面（即"该域名的完整列表"）。
export function filterInScope(pages, query) {
  const list = [...(pages || [])];
  const words = splitWords(query);
  if (!words.length) return list.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

  const full = String(query || '').trim().toLowerCase();
  const scored = [];
  for (const p of list) {
    const title = (p.title || '').toLowerCase();
    const url = (p.url || '').toLowerCase();
    const path = (p.path || '').toLowerCase();
    const hay = `${title} ${url} ${path}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 40;
      if (url.includes(w)) s += 10;
    }
    if (full && (title.includes(full) || url.includes(full))) s += 20;
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || b.p.lastVisitTime - a.p.lastVisitTime);
  return scored.map((x) => x.p);
}
