// 数据层：三条只读通道 + 一条写通道（按域名清除）。
// 所有读调用都显式传 startTime:0 与足够大的 maxResults，
// 否则 Chrome 默认只查最近 24 小时 / 100 条，会静默毁掉"全量"。

const FIRST_SCREEN_CAP = 200;
const SEARCH_CAP = 1000;
const SEG_CAP = 1000;
const SEG_TRIGGER = 500; // 见 SPEC §6.3：不依赖文档未明示的 maxResults 硬上限
const DELETE_BATCH = 10;
const DAY = 86400_000;
const WEEK = 7 * DAY;
const HORIZON = 90 * DAY;

async function safeSearch(query) {
  try {
    const result = await chrome.history.search(query);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.warn('[history] search failed', err);
    return [];
  }
}

function byTime(items) {
  return items.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
}

// 通道一：首屏，一次 API 调用。
export async function firstScreen() {
  const items = await safeSearch({ text: '', startTime: 0, maxResults: FIRST_SCREEN_CAP });
  return byTime([...items]);
}

// 通道三：搜索，下推原生索引。多词且召回过少时按词并发降级。
export async function searchAll(query) {
  const q = String(query || '').trim();
  const raw = byTime([...await safeSearch({ text: q, startTime: 0, maxResults: SEARCH_CAP })]);
  const words = q.split(/\s+/).filter(Boolean);
  if (raw.length < 3 && words.length > 1) {
    const parts = await Promise.all(
      words.slice(0, 3).map((w) => safeSearch({ text: w, startTime: 0, maxResults: SEARCH_CAP })),
    );
    const merged = new Map();
    for (const part of [...parts, raw]) {
      for (const it of part) if (!merged.has(it.url)) merged.set(it.url, it);
    }
    return byTime([...merged.values()]);
  }
  return raw;
}

async function splitByDay(start, end, isCancelled) {
  const out = [];
  let cursor = start;
  while (cursor < end) {
    if (isCancelled && isCancelled()) return out;
    const next = Math.min(cursor + DAY, end);
    const part = await safeSearch({ text: '', startTime: cursor, endTime: next, maxResults: SEG_CAP });
    out.push(...part);
    cursor = next;
  }
  return out;
}

// 通道二：按周分段加载全部历史（async generator，让调用方增量渲染）。
// search 对每个 URL 只按 lastVisitTime 返回一条，且时间窗口互不重叠，段间天然不重复；
// 仍用 seen 按 url 兜底去重。
export async function* iterateAll(isCancelled) {
  const now = Date.now();
  const floor = now - HORIZON;
  const totalWeeks = Math.ceil(HORIZON / WEEK);
  const seen = new Set();
  let cursor = now;
  let done = 0;

  while (cursor > floor) {
    if (isCancelled && isCancelled()) return;
    const start = Math.max(cursor - WEEK, floor);
    let part = await safeSearch({ text: '', startTime: start, endTime: cursor, maxResults: SEG_CAP });
    if (part.length >= SEG_TRIGGER) part = await splitByDay(start, cursor, isCancelled);

    const fresh = [];
    for (const it of part) {
      if (!seen.has(it.url)) {
        seen.add(it.url);
        fresh.push(it);
      }
    }
    done += 1;
    yield { items: fresh, loaded: done, total: totalWeeks };
    cursor = start;
  }
}

// ---- 写通道：按域名清除（SPEC v1.1 §6.7）----
//
// 严格两阶段，顺序不可调换：
//   阶段一 scanHistory：只读枚举 90 天全量，本地精确匹配，收集完整 URL 清单；
//   阶段二 deleteUrls ：拿到完整清单之后才逐条 deleteUrl。
// 绝不能"边查边删"——删除会改变 lastVisitTime，使按时间分段的游标失效，静默漏删。
// Chrome 没有按域名删除的 API，deleteRange 会误伤其它域名，deleteAll 更不可用，
// 所以只能走 deleteUrl；history 权限本身已涵盖删除，无需新增权限。

// 阶段一：复用 iterateAll 的同一套分段口径（按周 + 满 500 按天细分），
// 保证"卡片上看到的页面""详情页列出的页面""被删掉的页面"三者完全一致。
export async function scanHistory(match, onProgress, isCancelled) {
  const found = new Map(); // url -> 原始 HistoryItem（deleteUrl 必须传原始 url）
  for await (const batch of iterateAll(isCancelled)) {
    if (isCancelled && isCancelled()) return { items: [], urls: [], visits: 0, cancelled: true };
    for (const it of batch.items) {
      if (!it || !it.url || found.has(it.url) || !match(it)) continue;
      found.set(it.url, it);
    }
    if (onProgress) onProgress(batch.loaded, batch.total, found.size);
  }
  if (isCancelled && isCancelled()) return { items: [], urls: [], visits: 0, cancelled: true };

  const items = [...found.values()].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  return {
    items,
    urls: items.map((i) => i.url),
    visits: items.reduce((n, i) => n + (Number(i.visitCount) || 0), 0),
    cancelled: false,
  };
}

// 阶段二：小批并发删除，返回成功删除的 URL 列表供调用方同步内存视图。
// deleteUrl 对不存在的 URL 也正常 resolve，天然幂等；取消只在本批结束后生效。
export async function deleteUrls(urls, onProgress, isCancelled) {
  const deletedUrls = [];
  let attempted = 0;
  let failed = 0;
  let cancelled = false;

  for (let i = 0; i < urls.length; i += DELETE_BATCH) {
    if (isCancelled && isCancelled()) { cancelled = true; break; }
    const batch = urls.slice(i, i + DELETE_BATCH);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        await chrome.history.deleteUrl({ url });
        return { url, ok: true };
      } catch (err) {
        console.warn('[history] deleteUrl failed', url, err);
        return { url, ok: false };
      }
    }));
    for (const r of results) {
      attempted += 1;
      if (r.ok) deletedUrls.push(r.url);
      else failed += 1;
    }
    if (onProgress) onProgress(attempted, urls.length, failed);
  }
  return { deletedUrls, deleted: deletedUrls.length, failed, attempted, cancelled };
}
