// 书签数据层（SPEC v1.3.0 §16.3）：以 chrome.bookmarks.getTree() 的全量重读为唯一真值。
// 与 history.js 刻意走不同路线：书签树通常几百~几千节点，一次读全量即可，
// 因此不缓存、不注册 change 事件、不落盘；切 tab / 写成功后 / 切回可见时各重读一次。
// 写操作一律由用户点击触发，绝不放在任何自动流程里（安全约束 11）。
// 本模块是纯逻辑 + chrome.bookmarks 调用，不碰 DOM。

import { normalizeItem, LOCAL_BUCKET } from './domain.js';

const LOCKED_IDS = new Set(['1', '2']);
const LOCKED_FOLDER_TYPES = new Set(['bookmarks-bar', 'other', 'managed']);

export function isFolder(node) {
  return !!node && !node.url;
}

// Chrome 官方：书签栏 / 其他书签不可重命名、移动、删除，根节点不可增删项，
// 受管节点（unmodifiable: 'managed'）一律不可写。
// folderType 需 Chrome 134+，老版本用 id 兜底；folderType: 'mobile' 可修改，不锁。
export function isLocked(node) {
  if (!node) return true;
  if (node.unmodifiable === 'managed') return true;
  if (node.folderType && LOCKED_FOLDER_TYPES.has(node.folderType)) return true;
  if (!node.parentId) return true;
  if (LOCKED_IDS.has(node.id)) return true;
  return false;
}

// 展平整棵树：保留原始节点引用（含 children，供 countSubtree 只读统计），
// 并为每个节点算出 folderPath（祖先文件夹名）与 locked。
function flatten(roots) {
  const nodes = [];
  const byId = new Map();
  // parentId / folderPath 由遍历推导，不依赖源节点是否带齐字段（Chrome 官方会带，
  // 但自建树 / 兼容层可能省略；推导后 isLocked 与聚合都能正确工作）。
  const walk = (list, parentPath, parentId) => {
    for (const n of list || []) {
      const folder = isFolder(n);
      const node = {
        ...n,
        parentId: n.parentId || parentId || '',
        isFolder: folder,
        folderPath: parentPath.slice(),
        locked: false,
      };
      node.locked = isLocked(node);
      nodes.push(node);
      byId.set(n.id, node);
      if (folder) {
        walk(n.children, n.title ? [...parentPath, n.title] : parentPath, n.id);
      }
    }
  };
  walk(roots, [], '');
  return { nodes, byId };
}

// 书签节点 -> PageItem 形状（复用 domain.js 的 URL 解析 / eTLD+1 / 特殊 URL 归档）。
// dateAdded -> lastVisitTime，visitCount 恒为 0；按节点 id 唯一，不按 url 去重。
export function toPage(node) {
  const p = normalizeItem({
    url: node.url,
    title: node.title || '',
    lastVisitTime: Number(node.dateAdded) || 0,
    visitCount: 0,
  });
  if (!p) return null;
  return {
    ...p,
    id: node.id,
    parentId: node.parentId || '',
    folderPath: node.folderPath || [],
    folderType: node.folderType || '',
    unmodifiable: node.unmodifiable || '',
    locked: !!node.locked,
    dateAdded: Number(node.dateAdded) || 0,
    isBookmark: true,
  };
}

export async function readAll() {
  const roots = await chrome.bookmarks.getTree();
  const { nodes, byId } = flatten(roots || []);
  const pages = [];
  for (const n of nodes) {
    if (n.isFolder) continue;
    const p = toPage(n);
    if (p) pages.push(p);
  }
  return {
    roots: roots || [],
    nodes,
    byId,
    pages,
    folders: nodes.filter((n) => n.isFolder),
    bookmarks: nodes.filter((n) => !n.isFolder),
  };
}

// 按注册域聚合成与 DomainCard 同形的卡片：按 id 不去重（保留重复收藏），不折叠长尾。
// 书签没有「访问次数」，排序按「最近添加」，isTail 恒 false。
export function aggregateBookmarks(pages) {
  const cards = new Map();
  for (const p of pages || []) {
    let card = cards.get(p.regDomain);
    if (!card) {
      card = {
        key: p.regDomain,
        label: p.regDomain === LOCAL_BUCKET ? '本地 / 其他' : p.regDomain,
        hosts: new Set(),
        pages: [],
        pageCount: 0,
        totalVisits: 0,
        lastVisitTime: 0,
        isTail: false,
        isSpecial: p.regDomain === LOCAL_BUCKET,
        isBookmark: true,
      };
      cards.set(card.key, card);
    }
    card.hosts.add(p.host);
    card.pages.push(p);
  }
  for (const card of cards.values()) {
    card.pages.sort((a, b) => b.dateAdded - a.dateAdded);
    card.pageCount = card.pages.length;
    card.totalVisits = 0;
    card.lastVisitTime = card.pages[0] ? card.pages[0].dateAdded : 0;
  }
  return cards;
}

// ---- 按文件夹聚合（§16.13：书签 tab 主视图 = 文件夹卡片墙）----
// 该版本不再把书签按 regDomain 聚合；一张卡片 = 一个书签文件夹，按 Chrome 书签树前序排列。

/** 文件夹完整路径（含自身），用于卡片头面包屑、作用域 chip 与详情页标题。 */
export function folderPathOf(data, folderId) {
  const f = data && data.byId && data.byId.get(folderId);
  if (!f) return [];
  return [...(f.folderPath || []), f.title || '未命名文件夹'];
}

/** 递归收集某文件夹及其所有子文件夹下的书签，保持树前序；不缓存。 */
export function subtreePages(data, folderId) {
  if (!data || !data.byId || !data.pages) return [];
  const root = data.byId.get(folderId);
  if (!root || !root.isFolder) return [];
  const ids = new Set();
  const walk = (n) => {
    ids.add(n.id);
    for (const c of n.children || []) {
      const cn = data.byId.get(c.id);
      if (cn && cn.isFolder) walk(cn);
    }
  };
  walk(root);
  return data.pages.filter((p) => ids.has(p.parentId));
}

// 一次算出「直属书签数」与「递归子树书签数」，避免在卡片循环里反复 O(n) 扫描。
function folderCounts(data) {
  const direct = new Map();
  const total = new Map();
  for (const p of data.pages || []) {
    direct.set(p.parentId, (direct.get(p.parentId) || 0) + 1);
    total.set(p.parentId, (total.get(p.parentId) || 0) + 1);
  }
  // 前序反转 => 子先于父，逐层把子树计数累加到父。
  const folders = [...(data.folders || [])].reverse();
  for (const f of folders) {
    if (!f.parentId) continue;
    const own = total.get(f.id) || 0;
    total.set(f.parentId, (total.get(f.parentId) || 0) + own);
  }
  return { direct, total };
}

/**
 * 把一组书签按「所在文件夹」聚成卡片。
 * pages 一般是搜索命中结果；data 是 readAll() 全量快照（提供树结构、总数与子文件夹）。
 * includeEmpty=true 输出全部文件夹（默认首屏，含空文件夹）；false 只输出有命中的卡片（搜索态）。
 * 卡片顺序 = data.folders 的树前序，绝不按 dateAdded 重排。
 */
export function aggregateFolders(data, pages, includeEmpty = true) {
  if (!data) return [];
  const byId = data.byId;
  const counts = folderCounts(data);
  const byParent = new Map();
  const orphan = [];
  for (const p of pages || []) {
    const f = byId.get(p.parentId);
    if (!f || !f.isFolder) { orphan.push(p); continue; }
    if (!byParent.has(f.id)) byParent.set(f.id, []);
    byParent.get(f.id).push(p);
  }
  const cards = [];
  for (const f of data.folders || []) {
    if (f.id === '0' || !f.parentId) continue; // 排除虚拟根节点
    const hit = byParent.get(f.id) || [];
    if (!includeEmpty && hit.length === 0) continue;
    const subs = [];
    for (const c of f.children || []) {
      const cn = byId.get(c.id);
      if (!cn || !cn.isFolder) continue;
      subs.push({
        id: c.id,
        label: c.title || '未命名文件夹',
        count: counts.total.get(c.id) || 0,
      });
    }
    const directTotal = counts.direct.get(f.id) || 0;
    cards.push({
      key: f.id,
      id: f.id,
      label: f.title || '未命名文件夹',
      path: folderPathOf(data, f.id),
      pages: hit,
      pageCount: hit.length,
      totalCount: directTotal,
      subfolders: subs,
      subfolderCount: subs.length,
      locked: !!f.locked,
      folderType: f.folderType || '',
      isEmpty: directTotal === 0 && subs.length === 0,
      isVirtual: false,
      isBookmark: true,
    });
  }
  // 防御：parentId 找不到文件夹节点的书签不丢，归入虚拟「未分类」卡片。
  if (orphan.length) {
    cards.push({
      key: '__unfiled__', id: '', label: '未分类', path: ['未分类'],
      pages: orphan, pageCount: orphan.length, totalCount: orphan.length,
      subfolders: [], subfolderCount: 0, locked: true, folderType: '',
      isEmpty: false, isVirtual: true, isBookmark: true,
    });
  }
  return cards;
}

// 纯内存硬过滤（§16.5）：单字即搜、多词 AND、中文可用、零 API 调用。
// 与 search.js 的 filterInScope 刻意分开：这里把 folderPath 也拼进 hay。
export function filterBookmarks(pages, query) {
  const list = [...(pages || [])];
  const words = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length) return list.sort((a, b) => b.dateAdded - a.dateAdded);

  const full = String(query || '').trim().toLowerCase();
  const scored = [];
  for (const p of list) {
    const title = (p.title || '').toLowerCase();
    const url = (p.url || '').toLowerCase();
    const path = (p.path || '').toLowerCase();
    const folders = (p.folderPath || []).join(' / ').toLowerCase();
    const hay = `${title} ${url} ${path} ${folders}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 40;
      if (folders.includes(w)) s += 25;
      if (url.includes(w)) s += 10;
    }
    if (full && (title.includes(full) || url.includes(full))) s += 20;
    scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || b.p.dateAdded - a.p.dateAdded);
  return scored.map((x) => x.p);
}

// 两步确认前的只读统计：删文件夹时给出准确的子树范围，绝不在统计阶段写。
export function countSubtree(node) {
  if (!node) return { folders: 0, bookmarks: 0, total: 0 };
  if (!node.isFolder) return { folders: 0, bookmarks: 1, total: 1 };
  let folders = 0;
  let bookmarks = 0;
  const walk = (list) => {
    for (const n of list || []) {
      if (isFolder(n)) { folders += 1; walk(n.children); }
      else bookmarks += 1;
    }
  };
  walk(node.children);
  return { folders, bookmarks, total: folders + bookmarks };
}

// ---- 写通道：全部由用户点击触发（MV3 Promise，Chrome 90+）----
export const createBookmark = ({ parentId, title, url }) =>
  chrome.bookmarks.create({ parentId, title, url });
export const createFolder = ({ parentId, title }) =>
  chrome.bookmarks.create({ parentId, title });
export const rename = (id, title) => chrome.bookmarks.update(id, { title });
export const move = (id, parentId, index) =>
  chrome.bookmarks.move(id, index == null ? { parentId } : { parentId, index });
export const removeBookmark = (id) => chrome.bookmarks.remove(id);
export const removeTree = (id) => chrome.bookmarks.removeTree(id);
