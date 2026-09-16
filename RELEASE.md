# 发布流程

面向维护者：安装包发布（网盘分发）与实验数据发布（应用内热更新）两条线，以及发布前核对清单。

## 一、安装包：网盘分发，COS 只做版本校对

1. 运行 `npm run verify`；在 Windows/Word 环境按需运行 `tests/electron_smoke.js`、`tests/word_integration.js`。
2. **先递增版本号**（`package.json` 与 `package-lock.json` 两处，如 `2.0.1`；必须是 `x.y.z` 三段式，应用内版本比较与数据包的 `minAppVersion` 都按三段式解析），再 `npm run build:win`。
   同一版本号不要出现两份不同内容的构建——用户端只按版本号判断新旧，同号无法发现修复。
3. 把安装包（建议用英文名副本 `labreport-setup-<版本>.exe`）放到网盘，并记下新链接与提取码。
4. 更新本地清单模板 `dist/latest.json`，再**上传覆盖 COS 上的 `latest.json`**（对象名固定，不带版本号）：

```json
{
  "version": "2.0.0",
  "notes": "本次更新说明（展示在用户端）",
  "downloads": [
    {"name": "百度网盘", "url": "https://pan.baidu.com/s/…实际分享链接", "hint": "提取码 xxxx"},
    {"name": "GitHub", "url": "https://github.com/muhan-ad/xdu-labreport-writer"}
  ]
}
```

客户端仅校对版本，发现新版后展示下载入口（可打开或复制链接），**不做应用内下载安装**。旧的 `url`/`fileName` 直链格式已废弃，不要再写。

> ⚠ **两个已经踩过的坑**
> 1. **对象名必须是 `latest.json`**：把本地文件按 `latest-<版本>.json` 上传，应用读不到（404），还会覆盖掉旧的可用清单。本地模板也因此固定叫 `dist/latest.json`——**本地叫什么，上传就叫什么**。
> 2. **不要手动删除桶里被清单引用的对象**：`latest.json`、`data-manifest.json`、`data-package-<当前数据版本>.zip` 都是活的。删掉数据包会让所有用户的"检查实验数据更新"直接失败（恢复方式：用本地同名 zip 原样重传，**无需重新签名**——只要 sha256 与线上清单一致）。发布流程会自动把旧包挪到 `app-data/archives/`，不需要人工清理。

## 二、实验数据：应用内热更新，必须签名

数据版本独立于应用版本，用管理器（`labreport-writer-manager`）发布；签名与清单协议两端必须一致。

- **常规发布**：管理应用 →「推送管理」→「推送实验包」（勾选实验 = 增量，不勾 = 全量）或「发布数据更新」（全量快照）。
- **下架/恢复实验**：管理应用「实验管理」里操作后，**必须再点一次「发布数据更新」**才会把下架清单下发给用户端；弹窗顶部会显示「线上数据版本 / 线上下架清单 / ⚠ 待发布」，据此判断是否还有变更没发。
- **发布策略**：以**全量快照**为准（增量包不是完整快照，长期只发增量会让跳版本用户漏更新；增量包会自动附带 `common/`）。
- 包内只允许 `.py/.json/.md/.png/.jpg/.jpeg`；不要打入报告、缓存、备份、隐藏文件。压缩包 ≤64MB，解压后 ≤256MB，单文件 ≤32MB，条目 ≤4096，压缩比 ≤500。
- 清单字段：`dataVersion / minAppVersion / url / size / sha256 / files / notes / signature`（下架清单 `removed` 仅在非空时出现）。**先上传 ZIP，再替换 `data-manifest.json`**；签名后不得手工改动清单字段。
- 客户端会校验签名、当前数据版本、最低兼容版本、来源域名、包大小与摘要、全部文件摘要，再事务合并。**已有用户数据不覆盖**；官方变体按上次官方基线三方合并。

### 信任密钥

- 客户端公钥：`src/update-public-key.pem`，随应用发布。
- 私钥保存在维护机器用户目录 `.labreport-release/data-update-ed25519.pem`，不在 Git 仓库或安装资源内，已限制本机文件 ACL。请离线备份；**私钥丢失无法继续给老客户端发数据包**，轮换需要发布带新信任配置的应用。
- `scripts/release-data.js init` 仅供首次建立信任（拒绝覆盖既有公钥、拒绝把私钥写入仓库）；手工签名可用 `scripts/release-data.js sign <私钥> <zip> <版本> <url> <输出清单> <说明>`。

## 三、投稿与反馈服务

部署 `cloud/contribute-credentials/index.js`，按同目录 README 配置安全策略。客户端使用 `files:[{key,size}]` 协议向该函数申请限时上传凭证（旧的 `keys` 请求会被拒绝）。云函数与网关配置不会因本地修改自动部署，上线前核验来源 IP 字段、COS 写权限与对象版本、限流与存储生命周期。

**桶权限**：`contributions/*`（含 `contributions/_meta/*`）必须**禁止匿名读取**（匿名 GET 应为 403）；仅公开 `data-manifest.json`、`data-package-*.zip`、`latest.json`、`app-data/archives/*`。改动后用无痕窗口各验一次 403 与 200，并回看访问日志。

## 四、发布前核对

- 本项目使用**无 Windows 数字签名的安装包**，不把购买证书作为发布前提；核验版本号与 SHA-256。实验数据包的 Ed25519 签名必须保留（用途不同）。
- 用干净环境验证：Word/Python/预览/更新/反馈/实验数据下载。
- 运行时版本记录见 `docs/python-runtime-inventory.json` 与 `requirements-runtime.txt`；更换嵌入式 Python 后重新生成这两份记录并重跑 `npm run verify`。
- 发一版新客户端后，建议自测一次「安装 → 检查更新 → 更新实验数据 → 生成一份报告」完整闭环。

## 五、本地发布物料

`dist/` 已被 gitignore，其中只有这些是有意义的产物：`win-unpacked/`（**桌面快捷方式直接启动的就是它，改完源码必须重新构建才生效**）、当前版本的 `实验搭子 Setup <版本>.exe` + 英文名副本 + `.blockmap`、`SHA256SUMS.txt`、`latest.json`（上传源）。其余 `latest.yml`、`builder-debug.yml` 等是构建副产物，可随时删除。
