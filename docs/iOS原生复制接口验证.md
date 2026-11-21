# iOS 原生复制接口验证

0.93.0 为 iOS 的报告正文、AI 结果和技能链接复制接入官方 `@capacitor/clipboard` 8.0.1；写入系统剪贴板，不主动读取剪贴板。原 Android 路径继续使用 `LabReportFiles.copyText`，浏览器继续使用浏览器剪贴板。空白或超过 100000 字符会在调用平台接口前拒绝；iOS 和浏览器接口失败时保留长按手动复制提示。

使用模拟 Capacitor 桥分别验证 iOS、Android 和浏览器的路由、中文与公式、非法长度、失败处理；报告复制界面回归 8 项、领域测试 375 项通过。实际 Android 模拟器中通过技能链接页面核对了调用原有原生方法的路径，拦截了测试调用，没有修改系统剪贴板。APK 构建及 36 个内置／插件类核对通过；插件使本地 APK 比 0.92.0 增加 3559 字节。iOS 资源与五个插件声明已同步并核对，但没有 Xcode 构建或 iPhone/iPad 设备测试，不将模拟桥结果称为 iOS 实机成功。

测试前模拟器未运行，启动既有 `LabMaker_API36` 后备份并更新至 0.93.0，217 个应用文件安装前后内容一致。未执行学校选退课、上传或付费模型请求。证据：`artifacts/verification/clipboard-platform/results.json`、`artifacts/verification/native-clipboard-routing-0.93.0/results.json`、`artifacts/verification/native-plugin-inventory-0.93.0.json`、`artifacts/verification/ios-sync-0.93.0/verification.json`、`artifacts/verification/emulator-update-0.93.0/results.json`。
