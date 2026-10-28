# 首页已看记录与每日课程解锁实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页最近列表只呈现有播放记录的视频，并为本机视频库提供按课程逐日解锁和播放入口拦截。

**Architecture:** 新增独立的本机 `DailyUnlockRepository` 与纯策略模块；Pinia store 汇总播放记录、课程状态与目录数据。设置页负责总开关，课程管理页创建文件夹快照或手选视频课程；视频库和播放器共用 store 的权限结果。

**Tech Stack:** uni-app、Vue 3、TypeScript、Pinia、uni 本机存储、Vitest、Vue Test Utils、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-27-daily-video-unlock-design.md`

## 实施结果（2026-10-27）

- [x] Task 1：每日解锁策略、仓库、午夜时钟与损坏存储校验。
- [x] Task 2：首页按播放历史筛选、排序及去重；视频库保持完整目录。
- [x] Task 3：设置总开关、文件夹递归快照、手选视频、冲突提示及确认删除。
- [x] Task 4：列表锁定提示、播放器解析前拦截、跨午夜及页面恢复刷新。
- [x] Task 5：完整自动化验证、H5/App 资源构建及差异检查。

验证：`npm.cmd run check` 通过（35 个测试文件、637 项测试、类型检查、H5 构建、安全扫描）；`npm.cmd run build:app` 通过；`git diff --check` 通过。

移动端 E2E：10/10 通过，含首页播放历史、课程创建、首集播放、锁定行拦截、播放器路由拦截、午夜自动开放与首集重复进入。测试媒体与百度响应为模拟数据，不代表真实百度账号播放验证。

本机缺少 Playwright 自带 Chromium，验证使用临时配置将 `use.launchOptions.executablePath` 指向本机 Chrome，其他配置继承 `playwright.config.ts`，执行 `npm.cmd run e2e -- --config=.playwright-chrome.local.config.ts --project=mobile`。临时配置验证后删除；项目默认配置保持不变。截图位于 `test-results/app-daily-course-locks-the-next-episode-until-local-midnight-mobile/`，已检查 settings.png 和 course.png。

设计稿状态和 README 已同步。当前保留 `codex/home-history-daily-unlock` 分支的未提交改动及用户已有 `.idea/git_toolbox_prj.xml`。未提交、未推送、未生成新 APK，也未进行这批功能的 Android 实机验证。

以下为原执行步骤记录；汇总完成状态与本次实际验证结果以上述记录为准，不追溯补记未在本次恢复中重放的历史 RED 步骤。

## Global Constraints

- 课程、开关与进度只保存在本机 `pianke:daily-unlock:v1`。
- 默认关闭每日解锁；关闭限制不得删除课程、播放历史、直链或目录缓存。
- 每门课程新建当天开放第一集，此后每个设备本地日历日零点累加开放一集，已开放集数累积保留。
- 创建课程时固定视频 ID、名称、路径快照；课程冲突按视频 ID 检测，已归属视频不能重复加入另一课程。
- 文件名以中文自然顺序排序；名称相同按路径、视频 ID 稳定排序。
- 播放器必须在任何播放地址解析之前拦截锁定视频。
- 保留工作区已有未提交文件；不提交、不推送、不请求真实百度授权或账号数据。

---

### Task 1: 每日解锁策略与本机仓库

**Files:**
- Modify: `src/domain/video.ts`
- Create: `src/features/daily-unlock/dailyUnlockPolicy.ts`
- Create: `src/features/daily-unlock/dailyUnlockRepository.ts`
- Create: `tests/unit/dailyUnlockPolicy.test.ts`
- Create: `tests/unit/dailyUnlockRepository.test.ts`

**Interfaces:**

```ts
interface DailyUnlockEpisode {
  videoId: string
  name: string
  sourceType: 'baidu' | 'direct'
  path?: string
}
interface DailyUnlockCourse {
  id: string
  name: string
  createdAt: number
  sourceFolderPath?: string
  episodes: DailyUnlockEpisode[]
}
interface DailyUnlockSettings {
  enabled: boolean
  courses: DailyUnlockCourse[]
}
interface VideoUnlockStatus {
  locked: boolean
  courseId?: string
  courseName?: string
  episodeNumber?: number
  unlockedCount?: number
  unlockAt?: number
}
```

`dailyUnlockPolicy.ts` exports `getUnlockedEpisodeCount(course, now)`, `getVideoUnlockStatus(settings, videoId, now)`, `sortCourseEpisodes(videos)`, and `findCourseConflict(courses, videoIds)`. Date differences use local year/month/day components converted to UTC day ordinals; status never subtracts fixed 24-hour durations. `DailyUnlockRepository` exports `DAILY_UNLOCK_STORAGE_KEY`, `load()`, and `save(settings)`; `load()` validates stored data and otherwise returns `{ enabled: false, courses: [] }`.

- [ ] **Step 1: 先写策略失败测试**，覆盖新建当天只开放第1集、次日开放第2集、跨多天累积、课程集数上限、同一视频索引、关闭开关旁路、中文数字排序与课程重复归属冲突。
- [ ] **Step 2: 运行 `npm run test:run -- tests/unit/dailyUnlockPolicy.test.ts`**，确认失败来自缺少策略导出/行为。
- [ ] **Step 3: 实现最小纯策略**。将年月日拆为本地整数日期并通过 `Date.UTC(year, month, day) / 86_400_000` 得日序号；可开放数为 `min(episodes.length, max(0, currentDay-createdDay+1))`。中文自然排序使用 `Intl.Collator('zh-CN', { numeric: true })`，再用路径、视频 ID 打破平手。
- [ ] **Step 4: 重跑该测试**，确认通过；再补上月末、年末、跨时区夏令时本地日期边界用例并确认通过。
- [ ] **Step 5: 先写仓库测试**，确认默认关闭、往返保存、未知字段忽略、坏 JSON 形状回退、重复课程/视频 ID 与异常字段不泄露到结果，也不改变其他 storage key。
- [ ] **Step 6: 运行 `npm run test:run -- tests/unit/dailyUnlockRepository.test.ts`**，确认新行为失败。
- [ ] **Step 7: 实现仓库结构校验和保存**，为 ID、名称、路径长度及课程/集数设置明确上限；任何非法课程整条丢弃，其他合法课程与设置仍可读取。
- [ ] **Step 8: 运行两组策略和仓库测试**，确认全通过。

### Task 2: Store 数据流与首页播放历史

**Files:**
- Modify: `src/stores/appStore.ts`
- Modify: `tests/unit/appStore.test.ts`
- Modify: `tests/components/home.test.ts`

**Interfaces:**

- Store 提供 `recentVideos`、`dailyUnlockSettings`、`videoUnlockStatus(videoId)`、`setDailyUnlockEnabled(enabled)`、`createDailyUnlockCourse(input)` 与 `deleteDailyUnlockCourse(courseId)`。
- `recentVideos` 是 `progressHistory` 与当前 `mergedVideos` 按 ID 连接的唯一视频，按对应 `updatedAt` 降序；同时间按视频 ID 稳定排序。
- 创建课程接收 `{ name, episodes, sourceFolderPath? }`；直接媒体的快照仅保存视频 ID、名称和来源类型，不复制其可能含签名参数的 URL，store 用依赖注入的时钟添加 `createdAt` 和随机 ID；冲突或持久化失败返回可检验的失败结果，不更新内存状态。

- [ ] **Step 1: 修改 store 测试先建立 RED**：目录中无历史的视频不出现在首页；记录指向现存视频时最近播放记录优先排序；完成记录也出现；孤儿记录隐藏并在视频再次同步后出现。
- [ ] **Step 2: 运行 `npm run test:run -- tests/unit/appStore.test.ts tests/components/home.test.ts`**，确认 recentVideos 断言失败。
- [ ] **Step 3: 将 store 的 `recentVideos` 改为进度连接器，并新增 `catalogRecentVideos` 保存完整目录排序**；`searchResults` 无查询时使用 `catalogRecentVideos`，视频库不改变原有列表语义。
- [ ] **Step 4: 在 `AppStoreDependencies` 注入仓库**；非 mock App 初始化加载课程设置，mock bootstrap 保持各测试场景隔离；课程操作只在仓库保存成功后更新 Pinia 状态。
- [ ] **Step 5: 加入课程状态选择器**，按当前目录/课程数据解析视频状态，允许无课程视频播放，按已解锁课程的同一视频状态保持一致，并对非法 course ID 返回安全失败。
- [ ] **Step 6: 重跑 store 与首页测试，并调整 library 读取 `catalogRecentVideos`**；组件测试断言首页六条以内均来自播放历史，最近时间顺序正确，完成视频保留，空状态提示已看记录为空。

### Task 3: 设置开关与每日课程管理界面

**Files:**
- Modify: `src/pages.json`
- Modify: `src/pages/settings/index.vue`
- Create: `src/pages/daily-unlock/index.vue`
- Modify: `tests/components/settings.test.ts`
- Create: `tests/components/dailyUnlock.test.ts`

**Interfaces:**

- Settings 开关使用 `store.setDailyUnlockEnabled()`；课程管理入口跳转到 `/pages/daily-unlock/index`。
- 课程页以 `store.folderTree` 浏览百度目录；也以 `store.mergedVideos` 显示可搜索、多选的全部视频（含直链）。选中整文件夹时递归收集该文件夹及子文件夹当下的视频。
- 创建时调用 store 的 `createDailyUnlockCourse()`；删除必须经 `uni.showModal` 确认后调用 `deleteDailyUnlockCourse()`。

- [ ] **Step 1: 先写设置测试**，断言默认开关为关闭、点击后持久状态为启用、重新关闭保留课程，并显示课程计数与管理入口。
- [ ] **Step 2: 运行 `npm run test:run -- tests/components/settings.test.ts`**，确认新选择器缺失导致 RED。
- [ ] **Step 3: 在设置页添加“每日解锁课程”区块**，用兼容 uni-app 的 `role="switch"` 按钮和清晰的“每日零点解锁下一集”说明；总开关不依赖百度是否连接。
- [ ] **Step 4: 先写课程管理组件测试**，断言创建当天可见课程、展示已解锁/总集数、文件夹可纳入嵌套视频、手选多视频按自然顺序创建、重复视频显示冲突、取消删除保持原课程。
- [ ] **Step 5: 运行 `npm run test:run -- tests/components/dailyUnlock.test.ts`**，确认管理页面测试按预期失败。
- [ ] **Step 6: 建立页面和导航注册**，实现课程列表、创建表单、文件夹选择、视频搜索/多选、自然排序预览、冲突说明和删除确认；无课程/无目录时显示空状态。
- [ ] **Step 7: 运行设置和课程页面测试**，确认全通过并检查没有令牌、直链 URL 或播放地址进入课程 UI。

### Task 4: 视频库状态提示与播放器强制拦截

**Files:**
- Modify: `src/components/VideoRow.vue`
- Modify: `src/pages/library/index.vue`
- Modify: `src/pages/player/index.vue`
- Modify: `tests/components/library.test.ts`
- Modify: `tests/components/player.test.ts`

**Interfaces:**

- `VideoRow` 接收可选 `unlockStatus: VideoUnlockStatus`，锁定时呈现非交互的锁标记和集数说明；未锁定外观保持现状。
- Library 点击锁定项目显示解锁提示，不调用 `uni.navigateTo`；已解锁项目继续导航。
- Player 在 `loadFromQuery` 找到视频后、`PlaybackResolver.createPlayerLoad` 前调用同一个 `store.videoUnlockStatus(id)`；锁定时进入安全锁定状态且 resolver 零调用。

- [ ] **Step 1: 先写 VideoRow、library 与 player RED 测试**：锁定标记可访问；点击锁定行显示带本地零点时间的提示且不跳转；深链加载锁定视频时解析器不调用；相邻视频仍可正常播放。
- [ ] **Step 2: 运行 `npm run test:run -- tests/components/library.test.ts tests/components/player.test.ts`**，验证测试在未实现时失败。
- [ ] **Step 3: 添加 `VideoRow` 状态呈现和 library 点击守卫**；保留已有 `.library-video-entry` 布局和批量加载。
- [ ] **Step 4: 增加播放器 `locked` 状态**，在解析媒体前校验，显示课程名、集数和下次解锁本地时间，且不得输出直链或百度令牌。
- [ ] **Step 5: 页面显示/恢复时重新计算日期**，在跨午夜仍前台显示的锁定页安排一次零点更新计时器，离开页面清理计时器；App 从后台恢复时重新读取本地日期。
- [ ] **Step 6: 重跑 library/player 组件测试**，并确保 resolver 在锁定场景调用次数为零。

### Task 5: 端到端与整体验证

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Modify: `README.md`（仅当现有用户说明需要同步时）

- [ ] **Step 1: 写 H5 端到端流程**：最近播放为空；播放一个公开视频模拟项后返回首页，只显示该条；进入设置开启每日解锁、建立含两集的课程，第一集可进播放器、第二集显示锁定且不解析媒体。
- [ ] **Step 2: 在 E2E 注入固定时钟或使用可控页面日期工具**，将时间跨到设备本地次日 00:00，断言第二集解除锁定，第一集仍可重复观看。
- [ ] **Step 3: 运行 `npm run e2e -- --project=mobile`**，确认端到端预期失败后修复测试环境/实现，而不是放宽断言。
- [ ] **Step 4: 执行 `npm run type-check`、`npm run test:run`、`npm run build:h5`、`npm run security:scan` 和 `git diff --check`**；所有既有安全、隔离、续播测试继续通过。
- [ ] **Step 5: 执行 `npm run build:app`** 验证 uni-app Android 目标可以编译；记录本地编译结果，不上传云构建或生成公开发布。
- [ ] **Step 6: 最终检查 `git status --short` 和分文件 diff**，确认只包含本设计涉及的源码、测试和文档；保留 `.idea/git_toolbox_prj.xml` 等已有用户文件。

---
