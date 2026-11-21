# iOS 报告分享路径验证

0.92.0 为 iOS 的报告“外部打开”和“保存报告”接入现有 Capacitor 文件与系统分享接口：从本机报告副本读取数据，写入缓存后交给系统分享面板，由用户选择目标应用或保存方式。系统分享结束后仅提示在目标应用中确认，不把分享成功当作外部文件已核实保存；取消分享显示中文提示。Android 仍使用既有原生打开及目标目录写入、回读核验。

以浏览器模拟 Capacitor 桥验证 iOS 正常打开／保存、取消、报告缺失，以及 Android 原生打开和已核实保存；验证了写入副本的数据和传给分享接口的文件地址。另完成两项报告界面回归各 8 项、375 项领域测试和 Android 完整构建。首次两项界面回归并行时复用同一临时浏览器目录而冲突；串行重跑通过，随后改为每次测试使用独立随机目录，并行重跑也通过。

Android 模拟器更新前已备份，安装前后 217 个应用数据文件内容一致。iOS 工程共享资源已同步并核对 92 个共享文件和 42 个运行资源。当前机器没有 Xcode，以上 iOS 结果是模拟桥和资源核对，未构建或在 iPhone/iPad 上运行；系统分享面板、外部应用及真实保存结果仍待设备验收。一站通、AI 等 iOS 原生能力也仍需移植。

证据：`artifacts/verification/report-platform-routing/results.json`、`artifacts/verification/emulator-update-0.92.0/results.json`、`artifacts/verification/ios-sync-0.92.0/verification.json`、`artifacts/verification/build-0.92.0.log`。未调用付费 API，未进行学校选退课或上传。
