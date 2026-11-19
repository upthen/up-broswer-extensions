// 顶栏分段控件的顺序与默认落点（v1.5.1）。
// 与 wiring.test.mjs 同因：本项目零依赖、没有 DOM 测试环境，只能对源码做静态断言。
// 这里锁的是「控件顺序」和「初始显隐」必须一致——两者任一漂移，都会让默认落到
// 一个不该出现的组合上（比如标签页排第一、打开却是历史视图，或反之）。
// 顺带锁住历史首屏的懒加载：默认视图不再是历史，启动时不该再无条件读 90 天历史。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('分段控件的顺序是 标签页 / 书签 / 历史', () => {
  const order = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['tabs', 'bookmarks', 'history']);
});

test('默认高亮的是标签页，不是历史', () => {
  const tabsBtn = html.match(/<button[^>]*id="tabTabs"[^>]*>/)[0];
  const historyBtn = html.match(/<button[^>]*id="tabHistory"[^>]*>/)[0];
  assert.match(tabsBtn, /is-active/);
  assert.match(tabsBtn, /aria-selected="true"/);
  assert.doesNotMatch(historyBtn, /is-active/);
  assert.match(historyBtn, /aria-selected="false"/);
});

test('初始视图显隐与默认落点一致：标签页可见、历史隐藏', () => {
  const tabsView = html.match(/<section[^>]*id="tabsView"[^>]*>/)[0];
  const historyView = html.match(/<div[^>]*id="historyView"[^>]*>/)[0];
  assert.doesNotMatch(tabsView, /\bhidden\b/);
  assert.match(historyView, /\bhidden\b/);
});

test('activeTab 初值与默认视图一致', () => {
  assert.match(app, /activeTab:\s*'tabs'/);
});

test('历史首屏改为按需读取，启动路径不再直接 firstScreen()', () => {
  assert.match(app, /async function ensureHistoryFirstScreen/);
  assert.match(app, /if \(state\.historyReady\) return/);
  // init 里不允许再有裸的 mergePages(await firstScreen())
  const initBody = app.slice(app.indexOf('async function init()'));
  assert.doesNotMatch(initBody, /mergePages\(await firstScreen\(\)\)/);
});
