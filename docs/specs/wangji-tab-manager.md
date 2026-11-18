# Spec: 网迹 · 标签页管理模块（v1.4.0）

> 日期：2026-11-18 ｜ 状态：ready-for-agent ｜ 基线分支：`origin/main` ｜ 任务分支：`feat/wangji-tab-manager`
> 需求来源：已完成的 grill-me 访谈（A–F 六个决策分支全部经用户逐项确认；F 的收口由用户「按工作流执行」整体确认）。本文件是后续 tickets 与实现的唯一需求输入。

## Problem Statement

网迹已经能把浏览历史和书签组织成卡片墙，但用户真正被卡住的场景是「浏览器里同时开着几十个标签页」：原生标签栏被压成一排小图标，看不清标题，也无法按站点批量清理。按站点逐个关掉既慢又容易漏。

用户曾用过 Tab Out 这类接管新标签页的标签管理工具，实测反馈是「太卡、不好用」。其后台服务在标签创建、关闭、URL 变化等事件上反复执行全量标签查询来刷新徽标，加上每次新建标签都要加载整个控制台页面，正好踩中用户对性能的雷区。同时，这类工具普遍引入本地存储与常驻监听，与网迹「不落库、不挂常驻监听、不发网络请求」的既有基线冲突。

因此需要一个**不接管新标签页、不破坏既有基线**的标签页管理能力：在网迹现有面板里，把所有已打开的标签页按域名组织起来，并提供粒度清晰的关闭操作。

## Solution

在网迹全屏面板顶栏的分段控件中增加第三个 tab「标签页」，与「历史」「书签」并列。进入该 tab 时才按需读取浏览器已打开的标签页元数据，按 eTLD+1 合并子域后渲染为卡片墙；每张卡片提供「全部关闭」，每一行提供「关闭其他」与单独关闭。所有关闭动作作用于真实浏览器标签页，面板自身与详情页被排除，固定标签不参与批量关闭。

权限上只新增 `tabs`（读取标签页网址/标题所必需），不新增 `storage`、`activeTab`、host 权限，也不写 `chrome_url_overrides`。零持久化、零 change 监听、零网络请求三条基线保持不变。数据只在切到该 tab、页面切回可见、关闭操作完成后以及用户点「刷新」时重新读取，模块在切到该 tab 时才动态加载。

## User Stories

1. As a user with many open tabs, I want a third "标签页" tab in the Wangji panel, so that I can manage currently open tabs without leaving the extension.
2. As a user who dislikes the new-tab takeover, I want normal new tabs to stay native browser pages, so that opening a tab remains fast.
3. As a user, I want the tabs module to load only when I switch to it, so that the history and bookmarks screens keep their current first-paint speed.
4. As a user, I want all open tabs across all browser windows listed, so that I can clean up without switching windows one by one.
5. As a user, I want tabs grouped by registered domain (eTLD+1), so that `mail.google.com`, `drive.google.com` and `www.google.com` appear as one `google.com` card.
6. As a user, I want `foo.github.io` and `bar.github.io` to remain separate groups, so that public-suffix exceptions are respected.
7. As a user, I want protocol handling to follow the existing normalization rules, so that non-http(s) URLs are not mistaken for registrable domains.
8. As a user, I want local, IP, intranet and browser-internal pages collected in a "本地 / 其他" bucket, so that they do not pollute domain cards.
9. As a user, I want the Wangji panel itself and its detail pages excluded from the list, so that a bulk close cannot close the UI I am looking at.
10. As a user with several copies of the same page, I want each tab listed separately, so that each one can be closed individually.
11. As a user, I want the special bucket pinned to the end of the panel, so that real domains come first.
12. As a user, I want cards sorted by descending tab count (ties by domain name), so that the biggest piles are the easiest to clean first.
13. As a user, I want tabs inside a card ordered by their original tab-strip order (window, then index), so that the list matches what I see in the browser.
14. As a user with tabs in several windows, I want a window indicator on each row, so that I can tell them apart.
15. As a user with pinned tabs, I want a "已固定" marker on those rows, so that I know why they are skipped by bulk close.
16. As a user, I want a card header showing the domain and tab count, so that I can judge its size at a glance.
17. As a user, I want only three tabs visible by default, so that the card wall stays compact.
18. As a user, I want an in-card "展开全部 N 个" control, so that I can see the rest without navigating to a detail page.
19. As a user, I want a text-labelled "全部关闭" button in the card header (not only an icon), so that I understand the destructive action and its confirmation step.
20. As a user, I want to close all tabs of one domain with one confirmed action, so that cleanup takes seconds instead of dozens of clicks.
21. As a user, I want a two-step confirmation before closing a whole domain, so that a mis-click cannot wipe an important group.
22. As a user, I want the confirmation to state the exact number of tabs and the subdomains involved, so that I can verify the scope before confirming.
23. As a user, I want pinned tabs skipped by domain-wide close, so that deliberately kept pages (mail, calendar) survive.
24. As a user, I want pinned tabs still individually closable, so that nothing is permanently locked.
25. As a user, I want group close and "关闭其他" to cover all browser windows, so that the same domain is cleaned everywhere at once.
26. As a user, I want group close to re-read the current tab list before removing, so that stale ids from a changed tab strip cannot cause wrong closes.
27. As a user, I want "关闭其他" on a tab row, so that I can keep the one page I still need and close everything else in that domain group.
28. As a user, I want "关闭其他" to inherit the same two-step confirmation and pinned-tab protection as group close, so that blast radius is handled consistently.
29. As a user, I want the confirmation copy for "关闭其他" to say which page is kept and how many will be closed, so that the exception is unambiguous.
30. As a user looking at a special-bucket row, I want "关闭其他" disabled there, so that the bucket cannot be bulk-closed through a back door.
31. As a user, I want a single-tab close button on every row, so that I can remove exactly one tab without confirmation.
32. As a user, I want a toast after closing tabs telling me `Ctrl+Shift+T` can restore them, so that I know recovery is possible.
33. As a user, I want no undo stack, recycle bin, or backup, so that the extension stays as simple as the history-deletion path.
34. As a user, I want identical-URL tabs marked as "重复" with a read-only pill, so that I can spot duplicates visually.
35. As a user, I want duplicate detection to require full URL equality including hash and query, so that different pages of the same site are never flagged as duplicates.
36. As a user, I want only the second and later copies marked, so that I can tell which one to keep.
37. As a user, I want no automatic dedupe button, so that no extra write path is introduced.
38. As a user, I want clicking a tab row to focus that existing tab (including across windows), so that I can jump back to work without creating duplicates.
39. As a user, I want tab focus to work for special pages too, so that `chrome://` and `file://` tabs are not dead entries.
40. As a user, I want clicking a row not to open a new tab, so that tab count does not grow while managing tabs.
41. As a user, I want the shared search box to filter the tab list in memory by title, URL, domain and subdomain, so that I can find a specific tab instantly.
42. As a user, I want single-character search with a short debounce and zero API calls per keystroke, so that filtering feels immediate.
43. As a user, I want the search string preserved when switching between the three tabs, so that I do not have to retype it.
44. As a user, I want a status line showing total tab count and domain count, so that I have an at-a-glance summary.
45. As a user, I want the tab list refreshed when I switch to the tab, when the page becomes visible again, after every close, and via a manual refresh button, so that it stays accurate without background listeners.
46. As a user, I want in-flight reads cancelled when I switch away, so that stale results cannot overwrite the current view.
47. As a user, I want write operations mutually exclusive with tab switching and with each other, so that overlapping confirmations cannot race.
48. As a user, I want the existing history and bookmarks behaviour completely unchanged, so that this feature introduces no regressions.
49. As a user, I want the permission list documented accurately (four permissions, no storage/host permissions), so that I understand what the extension can access.
50. As a user, I want the install notes and README updated, so that the new permission and behaviour are explained before updating.
51. As a user, I want the acceptance checklist extended and the old checklist re-run, so that the feature is verifiable by the same manual method used so far.

## Implementation Decisions

- **形态与入口**：扩展面板顶栏分段控件从两个值扩为三个值（`history` / `bookmarks` / `tabs`）。不写新标签页覆盖，不做 popup、不做 content script。新模块以动态加载方式引入，历史/书签首屏不加载其代码。
- **权限**：manifest 权限从三项扩为四项，只增加 `tabs`。不增加 `storage`、`activeTab`、host 权限、`chrome_url_overrides`。`tabs` 权限仅用于读取标签页元数据；关闭标签所调用的 API 本来就不要求该权限。
- **数据读取**：只通过标签查询接口读取全部窗口的标签元数据，不读取网页正文、不注入脚本。读取时机严格限定为：切到「标签页」tab、页面重新可见、每次关闭操作完成后、用户点刷新。不注册任何标签或窗口事件监听，不使用 service worker 后台逻辑。
- **分组**：复用既有域名归组逻辑按 eTLD+1 合并子域。必须经由既有归一化入口做协议白名单判断，不能把 URL 直接交给注册域名解析函数——否则浏览器扩展协议地址会被当成单标签内网主机而单独成组。本地主机、IP、内网单标签主机、浏览器内部页面统一归入特殊桶。
- **行模型**：一个浏览器标签页对应一行，不按 URL 去重；标签对象自带的窗口 id、标签索引、活动状态和固定状态用于展示与排序。面板自身与详情页按扩展地址前缀剔除。
- **展示**：沿用卡片墙视觉语言与既有圆角、图标化、标题可读规范。卡片头显示域名与数量以及带文字的「全部关闭」；默认三条预览，卡内展开；组内按窗口与索引排序，卡片按 tab 数降序、同数按域名排序；特殊桶固定末位。
- **重复标记**：仅当完整 URL（含 hash 与查询串）完全相等时判定为重复；第二个及之后显示只读标记；不自动去重、不提供去重按钮。
- **关闭语义**：三条写路径——组级「全部关闭」、行级「关闭其他」（保留本行，关闭同 eTLD+1 组内其余全部）、行级「单独关闭」。前两条跨全部窗口、走两步确认（确认前零次关闭调用）、跳过固定标签，确认文案给出准确数量、子域明细与 `Ctrl+Shift+T` 恢复提示，且不得写「不可撤销」；第三条一次点击即关。特殊桶禁用前两条，但保留行级关闭。关闭前用最新标签列表重新计算目标 id。
- **跳转**：点击行按标签 id 激活既有标签并必要时聚焦其窗口，不新建标签、不走 URL 协议白名单。
- **状态与竞态**：搜索沿用三个 tab 共用输入框、保留关键词并按当前数据源重查的模式，标签页 tab 采用纯内存过滤。写操作期间禁止切换 tab；切走即作废在途读取与确认。关闭后反馈使用既有 toast。
- **模块划分**：新增一个纯逻辑模块（分组、重复判定、排序、关闭目标计算、确认统计数据源，不依赖任何浏览器 API）与一个面板模块（读取、渲染、三条写路径、两步确认、竞态与互斥）。现有域名、历史、书签与后台模块不改动。
- **文档与版本**：版本升到 1.4.0；在现有规格文档新增一章，明确覆盖「不声明标签权限」「不做标签权限与存储新权限」「权限清单恰为三项」等旧条款，并记录已知限制；同步安装说明与顶层 README。
- **已知限制**：停留在该 tab 时别处开关标签不会自动刷新；精简公共后缀表的小众后缀误合并风险沿用；无痕窗口默认不可见；关光某窗口全部标签会连带关闭该窗口（面板所在窗口因面板被排除而保留）。

## Testing Decisions

- **什么样的测试算好测试**：只断言外部可观察行为（给定标签集合 → 分组结果、排序结果、重复标记、关闭目标 id 与确认统计），不断言内部实现细节；纯逻辑测试不依赖浏览器环境。
- **自动化测试 seam（新增且唯一）**：纯逻辑模块用 Node 内置测试运行器与断言库测试，零依赖、零构建；为该扩展补一个最小包声明以启用 ES module 语义与测试脚本，浏览器加载扩展时忽略该声明。
- **重点测试场景**：eTLD+1 合并与公共后缀例外；非 http(s) 协议归特殊桶；扩展地址不被当成独立域名；一个 URL 多个标签不去重；按数量与域名排序、组内按窗口与索引排序；完整 URL 相等才算重复且只标后续副本；关闭目标计算跳过固定标签与面板自身；特殊桶不产生批量关闭目标；确认统计的数量与子域明细正确。
- **扩展页验收 seam（沿用既有）**：按项目既有规格文档的验收口径手工验收，续编编号 49–60，并重跑 1–48 回归。重点覆盖权限清单、面板自身不出现、三类关闭的范围与确认、跨窗口、点击不新增标签、切回可见刷新、输入零 API 调用、零持久化与零外部请求。
- **先例**：既有域名归组模块本身就是纯逻辑、不依赖浏览器 API，是最直接的测试风格参照；项目没有浏览器端自动化测试框架，手工验收清单是既定做法。

## Out of Scope

- 接管新标签页、popup、content script、host 权限、`activeTab`。
- `chrome.storage`、localStorage、IndexedDB 或任何形式的持久化；稍后读、记住折叠态。
- service worker 常驻监听、标签事件监听、工具栏徽标计数、关闭音效、彩带动画。
- Tab Out 的「首页/落地页」独立分组、自动去重按钮、跨源合并。
- 撤销栈、回收站、删除备份；详情页任何写入口。
- Firefox / Safari 适配、商店上架、跨设备同步、网页正文抓取、隐私过滤。
- 对历史、书签、后台单实例握手模块的改造。

## Further Notes

- 参考项目 `zarazhangrui/tab-out` 仅作为「分组卡片 + 两级关闭 + 点击跳转」骨架的参考，其存储、新标签页覆盖、常驻监听与动效均不采纳。
- 用户实测反馈「接管新标签页太卡、不好用」是本规格排除该形态的直接依据；该项目的后台在标签事件上频繁全量查询被认为是卡顿来源。
- 权限破例的边界是本规格最关键的安全决策：只破「读标签元数据」一处，其余三条硬基线（零持久化、零 change 监听、零网络）原样保留。
- 关闭标签与删除历史不同，浏览器支持 `Ctrl+Shift+T` 恢复，因此确认文案必须避免「不可撤销」这类不准确表述。
