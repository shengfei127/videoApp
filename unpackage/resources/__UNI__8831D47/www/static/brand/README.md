# 片刻应用标识

绿色底色延续 App 视觉风格；米白播放键代表视频，圆环和珊瑚色圆点表达时间与每日学习。

- `pianke-logo.png`：1024×1024 高清主图，使用 api2img 原创生成。
- `icon-48/72/96/144/192.png`：Android 桌面图标，对应 manifest 中的密度配置。
- `favicon-32.png`：网页版标签图标。

图标保持方形满底色，由系统决定桌面遮罩。主图修改后，需同步导出所有尺寸。
Android 图标已在 `src/manifest.json` 配置，重新打包并安装 APK 后生效。

此项目通过 HBuilderX 导入仓库根目录打包，manifest 中的图标路径相对仓库根目录，使用 `src/static/brand/` 前缀。
