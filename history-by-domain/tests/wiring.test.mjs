// 视图接线的静态回归（本项目零依赖，没有 DOM 测试环境）。
// 目的很窄：锁住「渲染时有按钮、点击时却拿不到 key」这一类接线缺陷——
// v1.5.0 就是这个 bug：卡片底部「展开全部 N 个」只挂了 data-action，
// 没挂 dataset.key，而事件委托要求 key 非空，于是点了完全没反应。
// 纯逻辑层（tabs.js）已有行为测试；这里只补 DOM 接线的存在性断言。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../tabs-panel.js', import.meta.url), 'utf8');

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
