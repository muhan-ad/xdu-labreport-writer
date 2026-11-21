# iOS 共享资源同步记录

2026-10-28 将 iOS 工程中 0.5.0 阶段的网页及报告运行资源更新至 0.88.0 共享构建；同步前的 53 个旧资源已压缩备份，Xcode 项目配置及 Swift Package 清单也已备份。工程的 Debug 和 Release 版本标识更新为 0.88.0（91）。这只是工程资源和版本标识，不是 iOS 安装包。

运行 `scripts/sync-ios-stage.ps1` 可重新构建共享页面、同步 Capacitor iOS 文件、更新工程版本并检查资源。`scripts/verify-ios-stage.mjs` 核对了 92 个共享文件字节、42 个报告运行资源的长度和 SHA-256、四个 Capacitor 插件声明及本地 Swift 包路径、两套工程版本设置。独立核对安卓 0.88.0 安装包与当前构建资源一致，安装包摘要未变。

当前电脑没有 Xcode 或 Swift 编译工具，没有构建或运行 iOS 程序，也没有验证 iPhone、iPad 的 Worker、文件读写、分享、预览或界面。共享资源一致仅表明资源已放入工程，不能证明 iOS 运行正常。学校选课与报告系统会话、教务认证、加密账号、AI 密钥与请求、资源维护、反馈贡献等仍依赖 Android 原生接口，需要逐项移植并在 Xcode 与设备上验证；不能把本次同步视为 iOS 功能完成。

证据：`artifacts/verification/ios-sync-0.88.0/verification.json` 和 `sync.log`；旧资源与工程备份也保存在该目录。未操作真实学校账号、上传、选退课或付费 API，未发布。
