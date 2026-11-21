# 手机版更新与 COS 发布验收（2026-11-05）

应用 0.142.0 (145)，实验资源 1.2.2。当前属于既有安装签名的安卓测试通道；iOS 仅同步工程版本。

## 已通过
- npm test：405/405。
- 28 个实验原生成器 WASM 报告生成全部通过。
- 独立 CPython / WASM 科学校验各 131/131；24 组不确定度各 156 项通过；单位错误变异被拒绝。
- 降温函数：缺省、全空、全零跳过，正常三点保留。
- 最终 Android JVM / assembleDebug 通过；APK 132 项资源、37 类原生定义与网络证书策略检查通过。
- COS 数据包匿名完整下载，发布签名/大小/哈希/实验目录/模板/字体校验通过；内容与内置资源逐项一致。
- 下载包在隔离内存存储模拟启用、重开与版本检查成功，不等同实体手机更新安装。

## COS 对象与状态
| 对象 | 状态 |
| --- | --- |
| mobile-data-manifest.json | 已发布，手机版数据更新入口使用 |
| mobile-data/data-1.2.2.json | 已发布，2,450,845 字节 |
| mobile-app/lab-maker-app-0.142.0.apk | 已上传，71,491,283 字节；COS 默认域名拒绝公开分发 APK |
| mobile-app/releases/0.142.0/mobile-app-manifest.json | 已上传候选清单；未激活 |
| mobile-app-manifest.json | 未发布，避免给用户提供无法下载的更新 |

桶 labreport-1485394950，区域 ap-guangzhou。匿名 APK 返回 403 DownloadForbidden，服务说明须使用自定义域名。get_bucket_domain 返回 DomainConfigNotFoundError。未修改桶 ACL、域名配置或绕过服务限制。已向用户询问可用 HTTPS 下载域名。需要接入域名并重新核对客户端 URL 校验、重打包和签名后才能启用应用发现清单；当前不宣称应用在线升级端到端完成。

本地包：android/app/build/outputs/apk/debug/app-debug.apk；签名候选与上传收据：artifacts/mobile-release/0.142.0/。数据包 SHA256：be5bd4bda3cdb1ccaa93c34cab0d5b152f78a1c226fe6bb12e5cb820903cc51b。

## 共源维护
权威来源为电脑版已发布签名 ZIP data-package-1.2.2.zip，SHA256 f739a7c6c73d276fd5be3c46b45c0f1ba2f9649c1362f3f0bb1d42e27f218445。不从混有未发布改动的桌面工作区取文件。

运行 scripts/import-published-resources.mjs --zip <发布ZIP> --manifest <签名清单>，先校验 Ed25519、包及全部文件 SHA256，再构造移动资源。scripts/lib/mobile-resource-overrides.json 保留 28 项既有手机版适配，逐文件绑定上游哈希；上游改变时必须复核，不能默默覆盖。仅提取 common、实验报告脚本/模板/schema/原理，过滤 data/sample/test-data；不读取用户配置或测量数据。src/data/resource-release.json 保存来源及适配摘要。两端共用来源和版本，但桌面 ZIP 与手机 JSON 格式不同，手机的科学/精度/照片表格/旧字段等适配仍明确保留，不声称字节完全相同。

内置版本展示 1.2.2，存储 0.0.0 sentinel 与防回退保留。数据协议当前要求实验目录与运行时兼容；新增字段/实验或运行时变化仍需先升级应用，不能把任意桌面 ZIP 直接给手机安装。

## 后续发布命令
- scripts/publish-mobile-updates.py --manager <管理器目录> --out <新候选目录> --apk <APK> 默认只生成候选；显式 --publish 才写 COS。
- --only-data 可独立发布资源；载荷先上传并匿名回读完整 SHA256，清单最后提交；不更改电脑版 latest/data-manifest。
- scripts/verify-published-mobile-data.mjs 核查真实云端资源与隔离存储切换。

未推送仓库；未操作学校选退课或报告上传。ADB 本轮没有设备；未在实体机覆盖安装此版、未验证系统安装确认流程，未清除用户数据。
