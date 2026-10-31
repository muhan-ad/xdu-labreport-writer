# 实验搭子手机版（ios）

本分支包含手机版共享页面、实验数据与离线报告运行资源，以及 ios 平台工程。另一平台工程在对应分支；Windows 版保留在 `master` 分支。

当前为 0.138.0 开发版。安卓功能仍需实体设备和真实服务验收；iOS 共享资源已同步，学校系统与 AI 等原生能力尚未完成，也尚未在 Xcode 或设备上构建验收。请勿将测试数据当作实测数据。

## 开发

安装 Node.js、平台开发工具及依赖后，在项目根目录执行：

```sh
npm ci
npm test
npm run build
npx cap sync ios
```

Android 还需要 Android SDK 和 JDK；iOS 需要 macOS 和 Xcode。`scripts` 中部分本地验收脚本依赖原开发环境的路径，跨设备运行前需要检查。请勿提交密钥、账号、本机数据、构建输出或调试安装包。
