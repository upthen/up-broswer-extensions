// 视图接线的静态回归（本项目零依赖，没有 DOM 测试环境）。
// 目的很窄：锁住「渲染时有按钮、点击时却拿不到 key」这类接线缺陷，以及
// 「渲染形态被改回去」的回归——v1.5.0 的「展开全部点了没反应」就是按钮
// 只挂了 data-action、没挂 dataset.key，而事件委托要求 key 非空（该按钮已在
// v1.5.4 随折叠一起去掉）。纯逻辑层（tabs.js）已有行为测试，这里只补 DOM 接线断言。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../tabs-panel.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('标签页卡片不做折叠：一次铺满该主机名的全部标签', () => {
  // v1.5.4：默认全展开，删掉了「展开全部 N 个」按钮与 PREVIEW 截断。
  // 若有人重新引入 slice(0, N)，卡片高度差会失效、瀑布流也白改。
  assert.doesNotMatch(src, /tabs-expand/);
  assert.doesNotMatch(src, /PREVIEW/);
  assert.doesNotMatch(src, /\.slice\(0,\s*\w+\)/);
  assert.match(src, /for \(const item of group\.tabs\)/);
});

test('标签页卡片墙用瀑布流：塞进最矮的列，不靠 CSS 多列', () => {
  assert.match(html, /id="tabsGrid" class="masonry"/);
  assert.match(css, /\.masonry\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.masonry\s*>\s*\.masonry-col\s*\{[^}]*flex:\s*1 1 0/);
  // 贪心分配必须真的在比「谁最矮」；退化成顺序填充就成了断层的多列。
  assert.match(src, /colHeights\[c\] < colHeights\[target\]/);
  assert.match(src, /cols\[target\]\.appendChild\(el\)/);
  // 卡片不跨列靠列容器实现，不再需要 break-inside
  assert.doesNotMatch(css, /column-width/);
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
