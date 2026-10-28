# 片刻视频播放器

片刻是一个 Android 优先的 uni-app 视频播放器：它可浏览百度网盘应用专属目录中的视频，也可保存 HTTPS MP4/M3U8 媒体直链，并在本机保留播放进度。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm install --cache .npm-cache
```

启动可重复的 H5 mock 环境：

```powershell
npx cross-env VITE_USE_MOCKS=true VITE_BAIDU_APP_KEY=mock-public-app-key npm run dev:h5 -- --host 127.0.0.1 --port 5173
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。可在 URL 的 hash 前加入 `?scenario=first-run`、`library`、`resume` 或 `baidu-error`，例如 `http://127.0.0.1:5173/?scenario=resume#/pages/home/index`。

常用检查：

```powershell
npm run type-check
npm run test:run
npm run test:coverage
npm run build:h5
npm run build:app
npm run security:scan
npm run e2e
```

## 最近播放与每日课程

首页“最近看过”只显示本机已有播放记录且仍在视频库中的视频，按最近观看时间排列，最多 6 条；视频库仍展示完整目录。

在“设置 → 每日课程”打开“每日解锁课程”，进入“管理课程”创建课程。可选择整个百度文件夹（包含子文件夹），也可手选百度视频和媒体直链。创建前可预览按文件名自然排序的集数。

创建当天开放第 1 集，此后按设备本地时间每天零点开放下一集；已开放的集数可反复观看，错过的天数会累积开放。课程按创建时的目录固定，后续新增视频需另建课程。关闭总开关会暂时解除限制，但保留课程；删除课程也不会删除视频。

课程与开关仅存于本机，清理播放历史或目录缓存不会删除课程。该功能使用设备时钟，适合自主学习安排，不提供跨设备同步或服务端防作弊。

连接页点击“授权并同步”后才启动百度授权，进入页面不会自动跳转。

## 百度 OAuth 配置

在仓库根目录新建被 Git 忽略的 `.env.local`。它只能包含公开 AppKey、应用目录、回调地址和 mock 开关：

```dotenv
VITE_BAIDU_APP_KEY=your-new-app-key
VITE_BAIDU_APP_FOLDER=片刻
VITE_BAIDU_REDIRECT_URI=https://openapi.baidu.com/oauth/2.0/login_success
VITE_USE_MOCKS=false
```

默认使用百度提供的登录完成页作为回调，App 在导航到该地址前拦截并校验 state：

```text
https://openapi.baidu.com/oauth/2.0/login_success
```

此前在截图、聊天记录或其他公开位置出现过的凭证，必须在真实联调前删除并重新创建。新 AppKey 只保存在本机 `.env.local`；不要把 SecretKey、SignKey、Access Token 或带 token 的播放 URL 放进仓库、日志、截图或构建产物。

## 内容与播放限制

- 只在 `/apps/片刻` 放入你拥有或已获授权的 H.264/AAC MP4 文件；若修改 `VITE_BAIDU_APP_FOLDER`，网盘目录也必须与之对应。
- 百度播放使用原始文件下载地址，不提供百度转码。设备不支持原始文件的容器、视频编码或音频编码时，播放器无法播放该文件。
- 未完成上线审核的百度应用通常受测试用户和请求额度限制：最多 10 个测试用户、每小时最多 10 次请求。开始真实测试前请以百度开放平台当前控制台限制为准。

### Android 百度原文件风险

百度原文件 `dlink` 播放需要在地址中附加 `access_token`，请求头设置 `User-Agent: pan.baidu.com`，并正确跟随百度返回的 302 跳转。片刻只在 App 平台设置该受限请求头；H5 浏览器禁止自定义 `User-Agent`，因此 H5 mock、单元测试和构建成功都不能证明 Android 原文件已经可播放。

发布前必须在真实 Android 设备上验证 uni-app 原生 `<video>` 是否完整转发请求头并跟随 302。若设备端未满足这两个条件，需要先改用经过安全审查的原生播放插件或原生请求方案；不得通过日志、截图或中转服务暴露 token。本项目尚未完成这项实机验证。

## Android 播放与续播验证

2026-10-26 已在 Android 11 模拟器验证原生公开视频播放、本机进度保存、重启后的续播提示以及跳转到保存位置。App 原生播放器通过首次有效 `timeupdate` 获取时长；未选择续播前不会覆盖旧记录。该记录对应当时版本；2026-10-28 的设计稿改造已将播放器调整为全屏舞台，视频保持原始比例完整显示，缩略图按各页面设计比例展示。新原生控制层尚待 Android 真机验证。

自动化验证覆盖百度视频解析、续播选择及进度保存。真实百度账号的原文件请求头、302 跳转和实际播放仍需账号实测，不能由公开视频验证代替。

## Android APK

使用 HBuilderX 导入项目后，先在 DCloud/HBuilderX 中配置有效的 AppID（`src/manifest.json`），再执行 Android 云打包或本地打包生成 APK。`npm run build:app` 只验证 App 资源可以编译，不等于已生成、签名或实机验证 APK。真实设备测试需要新建的百度应用、已登记的回调地址，以及已获授权的测试百度账号。
