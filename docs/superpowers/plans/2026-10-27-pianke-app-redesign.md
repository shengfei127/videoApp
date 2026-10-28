# 片刻全页面视觉改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已确认的“片刻”六页面设计稿，统一重做 Android App 的视觉层，同时保留现有数据、路由、播放、续播、课程和授权逻辑。

**Architecture:** 先建立 Logo 驱动的视觉令牌，再改公共组件，最后改六个页面的局部布局与样式。只调整模板中的品牌展示和 CSS，不改变 store、服务、数据结构或路由；已有行为测试继续作为功能护栏，补充页面视觉契约测试确保 Logo、导航和核心界面标识不会回退。

**Tech Stack:** Vue 3 `<script setup>`, uni-app, SCSS, Pinia, Vitest, HBuilderX 调试基座。

**Spec:** 已批准的 `output/imagegen/pianke-app-redesign-20261027-v2.png` 视觉设计稿。

## Global Constraints

- 视觉基调固定为暖象牙白、深翡翠绿、近黑绿文字和少量珊瑚橙。
- 不新增依赖，不修改现有业务接口、数据结构、路由和授权逻辑。
- 不把敏感 URL、Token 或授权凭证渲染到界面。
- 保留现有页面的 `data-testid`、无障碍标签和核心交互。
- 兼容 uni-app Android 老 WebView；关键间距使用 margin/padding，不能只依赖 flex gap。
- 本轮只做源码、测试和调试基座验证，不生成 APK。

---

### Task 1: 建立品牌令牌和全局基础

**Files:**
- Modify: `src/styles/tokens.scss`
- Modify: `src/styles/global.scss`
- Modify: `src/components/BottomNav.vue`
- Test: `tests/components/home.test.ts`

- [ ] **Step 1: 添加视觉契约测试**

在 `tests/components/home.test.ts` 增加测试，挂载 `BottomNav`，验证活动项仍有 `aria-current="page"`，并验证组件根节点包含新版品牌类 `bottom-nav--premium`。

- [ ] **Step 2: 运行目标测试确认新契约失败**

运行 `npm.cmd run test:run -- tests/components/home.test.ts`，预期只因 `bottom-nav--premium` 尚不存在而失败。

- [ ] **Step 3: 实现令牌与全局基础**

把 tokens 更新为暖象牙背景、纸张表面、深翡翠主色、珊瑚强调色、细分割线和低对比阴影；全局字体改成 `Avenir Next, SF Pro Display, PingFang SC, Microsoft YaHei, sans-serif`，并给 `.page-shell` 增加统一的内容宽度、底部导航安全区和标题字距。

给 `BottomNav.vue` 增加 `bottom-nav--premium` 根类、较轻的底部纸张面、活动项圆形/胶囊状态和稳定的 margin 间距。

- [ ] **Step 4: 运行目标测试确认通过**

运行 `npm.cmd run test:run -- tests/components/home.test.ts`，预期通过。

---

### Task 2: 公共视频行、续播弹窗和直链面板

**Files:**
- Modify: `src/components/VideoRow.vue`
- Modify: `src/components/ResumeDialog.vue`
- Modify: `src/components/DirectLinkSheet.vue`
- Modify: `src/components/VideoThumbnail.vue`
- Test: `tests/components/home.test.ts`
- Test: `tests/components/library.test.ts`

- [ ] **Step 1: 保持公共行为契约**

在现有组件测试中保留单根按钮、敏感 URL 不渲染、锁定文案和弹窗按钮的断言；只增加一个断言，确保缩略图容器带新版 `video-thumbnail--premium` 类。

- [ ] **Step 2: 运行目标测试确认新契约失败**

运行 `npm.cmd run test:run -- tests/components/home.test.ts tests/components/library.test.ts`，预期只因新类尚不存在而失败。

- [ ] **Step 3: 统一公共组件样式**

视频行改成设计稿中的缩略图加标题/来源/时长信息，使用更窄的正文尺寸、细分割线和 12px 级圆角；续播弹窗改成中央纸张面板并突出翡翠色主操作；直链面板改成有顶部拖拽提示、清晰字段层级和底部主按钮；缩略图 fallback 使用深墨绿底和淡象牙图标。

- [ ] **Step 4: 运行目标测试确认通过**

运行同一组组件测试，预期全部通过。

---

### Task 3: 首页和视频库

**Files:**
- Modify: `src/pages/home/index.vue`
- Modify: `src/pages/library/index.vue`
- Test: `tests/components/home.test.ts`
- Test: `tests/components/library.test.ts`

- [ ] **Step 1: 为核心页面标识增加失败契约**

增加测试断言：首页有 `home-brand-mark`、`home-resume--hero`，视频库有 `library-header--premium`；不改变现有文字和路由断言。

- [ ] **Step 2: 运行目标测试确认失败**

运行 `npm.cmd run test:run -- tests/components/home.test.ts tests/components/library.test.ts`，预期只因新版类和 Logo 标记不存在而失败。

- [ ] **Step 3: 重做首页与视频库视觉层**

首页添加真实 Logo 小标和极简品牌头部，把续播区提升为大图主卡，最近看过保留纯列表，来源操作收敛为低干扰快捷项。视频库按设计稿统一搜索、最近/文件夹切换、缩略图网格/列表和文件夹行，保留分页加载、编辑直链、目录切换和搜索逻辑。

- [ ] **Step 4: 运行页面测试确认通过**

运行两页组件测试，预期全部通过。

---

### Task 4: 播放器、每日课程、设置和授权页

**Files:**
- Modify: `src/pages/player/index.vue`
- Modify: `src/pages/daily-unlock/index.vue`
- Modify: `src/pages/settings/index.vue`
- Modify: `src/pages/oauth/index.vue`
- Test: `tests/components/player.test.ts`
- Test: `tests/components/dailyUnlock.test.ts`
- Test: `tests/components/settings.test.ts`

- [ ] **Step 1: 增加页面视觉标记测试**

增加不依赖业务数据的 class/标记断言：播放器 `player-page--immersive`，每日课程 `daily-unlock-page--premium`，设置 `settings-page--premium`，授权页 `oauth-page--premium`。

- [ ] **Step 2: 运行目标测试确认失败**

运行 `npm.cmd run test:run -- tests/components/player.test.ts tests/components/dailyUnlock.test.ts tests/components/settings.test.ts`，预期只因新版页面类不存在而失败。

- [ ] **Step 3: 重做四页视觉层**

播放器采用深墨绿沉浸背景、窄标题栏、宽视频舞台和底部速度控制；每日课程按设计稿收紧输入、来源切换、集数清单和进度信息；设置改成轻量分组行、明确的开关和低干扰危险操作；授权页加入 Logo 标识、云连接状态和单一主按钮。所有现有状态、错误、删除确认、重试、课程创建和授权动作保持原逻辑。

- [ ] **Step 4: 运行目标测试确认通过**

运行三页组件测试，预期全部通过。

---

### Task 5: 整体验证与调试基座检查

**Files:**
- Modify: `src/pages/*/index.vue` only if verification reveals layout regressions
- Create: `dist/release/pianke-redesign-validation.txt`

- [ ] **Step 1: 运行完整源码检查**

运行 `npm.cmd run check`，确认类型检查、所有 Vitest、H5 构建和安全扫描通过。

- [ ] **Step 2: 运行 Android 调试基座**

使用 HBuilderX standard playground 启动 `pages/home/index`，依次检查首页、视频库、设置、每日课程和授权页截图；确认状态栏安全区、底部导航、长文本、弹窗和播放器深色页面没有遮挡。

- [ ] **Step 3: 保存验证记录并停止模拟器**

将验证范围写入 `dist/release/pianke-redesign-validation.txt`，明确本轮没有生成 APK；关闭调试基座/模拟器，删除本轮自动生成且明确可删的 `.hbuilderx/launch.json`。

---
