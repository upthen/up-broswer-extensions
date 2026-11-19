// 视图接线的静态回归（本项目零依赖，没有 DOM 测试环境）。
// 目的很窄：锁住「渲染时有按钮、点击时却拿不到 key」这一类接线缺陷——
// v1.5.0 就是这个 bug：卡片底部「展开全部 N 个」只挂了 data-action，
// 没挂 dataset.key，而事件委托要求 key 非空，于是点了完全没反应。
// 纯逻辑层（tabs.js）已有行为测试；这里只补 DOM 接线的存在性断言。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../tabs-panel.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('展开按钮必须把卡片 key 挂到 dataset 上', () => {
  assert.match(src, /more\.dataset\.key\s*=\s*group\.key/);
});

test('事件委托必须能从所属卡片兜底取 key', () => {
  assert.match(src, /pickActionKey\(/);
  assert.match(src, /closest\('\.card'\)/);
});

test('卡片级关闭按钮同样要挂 key', () => {
  assert.match(src, /closeAll\.dataset\.key\s*=\s*group\.key/);
});

test('标签页关闭走一次点击即执行，不再渲染第二步确认条', () => {
  // v1.5.3：批量关闭也要点两下才生效，日常高频操作里比误关更烦。
  // 三条写路径都必须直接落到 applyClose；确认条的 DOM 与处理器一并删掉。
  assert.doesNotMatch(src, /data-action="tabs-confirm"/);
  assert.doesNotMatch(src, /data-action="tabs-cancel"/);
  assert.doesNotMatch(src, /class="del-bar"/);
  assert.match(src, /function closeGroup\(key\)[\s\S]{0,240}applyClose\(/);
  assert.match(src, /function closeOthers\(tabId\)[\s\S]{0,240}applyClose\(/);
});

test('行悬浮高亮必须挂在 li 上，不能挂在 .tab-focus 上', () => {
  // v1.5.2：高亮写在 .tab-focus（flex: 1 1 auto）上时只盖标题区，右侧操作按钮区
  // 不变色，看起来像被切断一块。这条锁住「整行高亮」的落点。
  assert.match(css, /\.card--tabs \.pages li:hover/);
  assert.match(css, /\.card--tabs \.pages li:focus-within/);
  const focusHover = css.match(/\.card--tabs \.tab-focus:hover\s*\{([^}]*)\}/);
  assert.ok(focusHover, '应保留 .tab-focus:hover 的文字变色规则');
  assert.doesNotMatch(focusHover[1], /background/);
});
