import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTabs, buildGroups, groupLabel, computeRemoveTargets, confirmText,
} from '../tabs.js';

const ORIGIN = 'chrome-extension://abcdefghijklmnop/';

const tab = (id, url, extra = {}) => ({
  id,
  windowId: 1,
  index: id,
  pinned: false,
  active: false,
  url,
  title: `title-${id}`,
  ...extra,
});

test('按 eTLD+1 合并子域，一张卡片包含该域名所有子域的标签', () => {
  const items = normalizeTabs([
    tab(1, 'https://mail.google.com/mail/u/0/'),
    tab(2, 'https://drive.google.com/drive/'),
    tab(3, 'https://www.google.com/'),
  ], ORIGIN);
  const groups = buildGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'google.com');
  assert.equal(groups[0].count, 3);
});

test('公共后缀例外：foo.github.io 与 bar.github.io 各自成卡', () => {
  const items = normalizeTabs([
    tab(1, 'https://foo.github.io/page'),
    tab(2, 'https://bar.github.io/page'),
  ], ORIGIN);
  const groups = buildGroups(items);
  assert.deepEqual(groups.map((g) => g.key).sort(), ['bar.github.io', 'foo.github.io']);
});

test('非 http(s) 页面归特殊桶，扩展自身的页面被剔除', () => {
  const items = normalizeTabs([
    tab(1, 'chrome://settings/'),
    tab(2, 'file:///C:/work/a.html'),
    tab(3, `${ORIGIN}index.html`),
    tab(4, `${ORIGIN}detail.html?domain=x.com`),
    tab(5, 'about:blank'),
  ], ORIGIN);
  assert.deepEqual(items.map((i) => i.tabId), [1, 2, 5]);
  assert.ok(items.every((i) => i.isSpecial));
  const groups = buildGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, '__local__');
  assert.equal(groupLabel(groups[0].key), '本地 / 其他');
});

test('同一 URL 的多个标签不去重，每个标签保留独立行', () => {
  const items = normalizeTabs([
    tab(1, 'https://example.com/a'),
    tab(2, 'https://example.com/a'),
    tab(3, 'https://example.com/b'),
  ], ORIGIN);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((i) => i.tabId)).size, 3);
});

test('卡片按标签数降序、同数按域名排序，特殊桶固定末位', () => {
  const items = normalizeTabs([
    tab(1, 'https://zzz.com/'),
    tab(2, 'https://aaa.com/'),
    tab(3, 'https://bbb.com/'),
    tab(4, 'https://bbb.com/x'),
    tab(5, 'chrome://extensions/'),
  ], ORIGIN);
  const groups = buildGroups(items);
  assert.deepEqual(groups.map((g) => g.key), ['bbb.com', 'aaa.com', 'zzz.com', '__local__']);
});

test('组内按窗口再按标签索引排序，跨窗口行保留 windowId', () => {
  const items = normalizeTabs([
    tab(1, 'https://example.com/a', { windowId: 2, index: 0 }),
    tab(2, 'https://example.com/b', { windowId: 1, index: 7 }),
    tab(3, 'https://example.com/c', { windowId: 1, index: 3 }),
  ], ORIGIN);
  const [group] = buildGroups(items);
  assert.deepEqual(group.tabs.map((i) => i.tabId), [3, 2, 1]);
  assert.equal(group.tabs[2].windowId, 2);
});

test('重复标记按完整 URL 相等判定，hash 不同不算重复，只标第二个及以后', () => {
  const items = normalizeTabs([
    tab(1, 'https://example.com/a#one'),
    tab(2, 'https://example.com/a#two'),
    tab(3, 'https://example.com/a#one', { windowId: 2, index: 0 }),
    tab(4, 'https://example.com/a#one', { windowId: 3, index: 0 }),
  ], ORIGIN);
  const byId = new Map(items.map((i) => [i.tabId, i]));
  assert.equal(byId.get(1).isDuplicate, false);
  assert.equal(byId.get(2).isDuplicate, false);
  assert.equal(byId.get(3).isDuplicate, true);
  assert.equal(byId.get(4).isDuplicate, true);
});

test('搜索为纯内存多词 AND，命中标题、网址与域名，大小写不敏感', () => {
  const items = normalizeTabs([
    tab(1, 'https://github.com/WorkBuddy/README', { title: 'Docs WorkBuddy' }),
    tab(2, 'https://github.com/WorkBuddy/issues', { title: 'Bug List' }),
    tab(3, 'https://example.com/other', { title: 'Docs Other' }),
  ], ORIGIN);
  assert.deepEqual(buildGroups(items, 'workbuddy docs').flatMap((g) => g.tabs.map((i) => i.tabId)), [1]);
  assert.deepEqual(buildGroups(items, 'GITHUB').flatMap((g) => g.tabs.map((i) => i.tabId)), [1, 2]);
  assert.deepEqual(buildGroups(items, '不存在的词').flatMap((g) => g.tabs.map((i) => i.tabId)), []);
});

test('组级关闭目标：跨窗口聚合、跳过固定标签、统计子域明细', () => {
  const items = normalizeTabs([
    tab(1, 'https://mail.google.com/a', { windowId: 1, index: 0 }),
    tab(2, 'https://mail.google.com/b', { windowId: 2, index: 0 }),
    tab(3, 'https://drive.google.com/c', { windowId: 1, index: 1 }),
    tab(4, 'https://www.google.com/d', { windowId: 1, index: 2, pinned: true }),
    tab(5, 'https://example.com/keep'),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'group', key: 'google.com' });
  assert.deepEqual(target.ids, [1, 2, 3]);
  assert.equal(target.count, 3);
  assert.equal(target.skippedPinned, 1);
  assert.deepEqual(target.subdomains, [
    { host: 'mail.google.com', count: 2 },
    { host: 'drive.google.com', count: 1 },
  ]);
  assert.equal(target.key, 'google.com');
});

test('特殊桶不产生整组关闭目标', () => {
  const items = normalizeTabs([
    tab(1, 'chrome://settings/'),
    tab(2, 'file:///C:/a.html'),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'group', key: '__local__' });
  assert.deepEqual(target.ids, []);
  assert.equal(target.count, 0);
});

test('确认文案含数量、子域与恢复提示，不写「不可撤销」', () => {
  const items = normalizeTabs([
    tab(1, 'https://mail.google.com/a'),
    tab(2, 'https://drive.google.com/b'),
    tab(3, 'https://www.google.com/c', { pinned: true }),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'group', key: 'google.com' });
  const text = confirmText(target, 'group');
  assert.match(text, /2 个标签页/);
  assert.match(text, /mail\.google\.com/);
  assert.match(text, /Ctrl\+Shift\+T/);
  assert.doesNotMatch(text, /不可撤销/);
});

test('关闭其他：保留本行，关闭同域名其余标签并跳过固定页', () => {
  const items = normalizeTabs([
    tab(1, 'https://mail.google.com/keep', { title: '要保留的页面', windowId: 1, index: 0 }),
    tab(2, 'https://mail.google.com/other', { windowId: 2, index: 0 }),
    tab(3, 'https://drive.google.com/x', { windowId: 1, index: 4, pinned: true }),
    tab(4, 'https://example.com/elsewhere'),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'others', tabId: 1 });
  assert.deepEqual(target.ids, [2]);
  assert.equal(target.count, 1);
  assert.equal(target.keep.title, '要保留的页面');
  assert.match(confirmText(target, 'others'), /保留「要保留的页面」/);
  assert.match(confirmText(target, 'others'), /其余 1 个标签页/);
});

test('特殊桶的「关闭其他」没有目标', () => {
  const items = normalizeTabs([
    tab(1, 'chrome://settings/'),
    tab(2, 'file:///C:/a.html'),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'others', tabId: 1 });
  assert.deepEqual(target.ids, []);
});

test('单独关闭：只关指定标签，固定标签也可关闭', () => {
  const items = normalizeTabs([
    tab(1, 'https://example.com/a', { pinned: true }),
    tab(2, 'https://example.com/b'),
  ], ORIGIN);
  const target = computeRemoveTargets(items, { mode: 'single', tabId: 1 });
  assert.deepEqual(target.ids, [1]);
  assert.equal(target.count, 1);
});
