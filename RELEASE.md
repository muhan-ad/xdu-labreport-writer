# 发布流程（1.7.6 起）

## 安装包：网盘分发，COS 仅校对版本

1. 运行 `npm run verify`；在 Windows/Word 环境运行 `tests/electron_smoke.js` 和 `tests/word_integration.js`。
2. 使用 `npm run build:win` 构建安装包，将安装包放到网盘。
3. 在 COS 更新 `latest.json`。不需要在 COS 上传安装包，不提供应用内下载安装功能。

```json
{
  "version": "1.7.6",
  "notes": "安全、预览与数据处理修复",
  "downloads": [
    {"name": "网盘下载", "url": "https://网盘服务域名/实际分享链接", "hint": "可填写提取码"}
  ]
}
```

客户端仅校对版本，发现新版后显示下载入口，用户可打开或复制链接。`url/fileName` 安装包直链旧格式不再回退展示。请填实际 HTTPS 分享链接，不要使用上述占位示例。

## 实验数据：保留应用内热更新，必须签名

数据版本独立于应用版本。ZIP 可包含 `实验脚本/` 根目录，或直接包含实验名与 `common/`。仅包含 `.py/.json/.md/.png/.jpg/.jpeg`，不要打入报告、缓存、备份或隐藏文件。

### 信任密钥

- 客户端公钥：`src/update-public-key.pem`，随应用发布。
- 本次初始化的私钥保存在维护机器用户目录 `.labreport-release/data-update-ed25519.pem`，不在 Git 仓库或安装资源内，已限制本机文件 ACL。
- 请离线备份私钥；私钥丢失不能用随机新私钥签出旧客户端接受的数据包。轮换需要发布带新信任配置的应用。
- `scripts/release-data.js init` 仅供首次建立信任，拒绝覆盖既有公钥或把私钥写入仓库。

### 签名发布

先生成 ZIP，再运行：

```powershell
node scripts/release-data.js sign "$env:USERPROFILE/.labreport-release/data-update-ed25519.pem" "dist/data-package-1.0.1.zip" "1.0.1" "https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/data-package-1.0.1.zip" "dist/data-manifest.json" "本次实验资源更新说明"
```

工具生成包含 `dataVersion/minAppVersion/url/size/sha256/files/notes/signature` 的清单，并用客户端公钥自检。最低客户端版本默认取本仓库应用版本。先上传 ZIP，再替换 COS `data-manifest.json`；签名后不得手工改动其中字段。

客户端会验证签名、当前版本、最低兼容版本、源域名、压缩包大小与摘要、全部文件摘要，再事务合并。压缩包最多 64MB，解压后最多 256MB，单文件最多 32MB、条目最多 4096，压缩比不超过 500。

已有用户数据不覆盖；官方变体按上次官方基线三方合并；新的资源备份保留最近两份。旧版本产生的无事务标记备份不会自动删除。

**兼容性提醒：** 1.7.6 不会接受无签名的旧实验包。必须同步采用新发布工具；这不影响已经安装的实验和本地报告生成。

## 投稿与反馈服务

部署 `cloud/contribute-credentials/index.js`，按同目录 README 配置安全策略。新客户端使用 `files:[{key,size}]` 协议，旧的 `keys` 请求会被拒绝；需先部署云函数，再发布客户端。

云函数与网关配置不会因本地修改自动部署。上线前核验函数平台来源 IP 字段、COS 写权限/对象版本设置、分布式限流和存储生命周期，执行测试投稿及反馈。

## 发布前核对

- 本项目按维护者选择使用无 Windows 数字签名的安装包，不把购买证书作为发布前提。核验版本号和 SHA-256；实验数据包 Ed25519 签名仍需保留，两者用途不同。
- 安装到无开发工具的 Windows 用户环境，验证 Word/Python/预览、更新及反馈。
- 运行时版本记录见 `docs/python-runtime-inventory.json`；更换嵌入式 Python 后重新生成记录并测试。

## 管理端兼容性

2026-09-15 核对相邻 `labreport-writer-manager/core/package.py`：管理端一键推送仍生成旧的无签名清单，不能直接用于 1.7.6 客户端。首次发布可使用本文件的签名工具手动发布；管理端接入该签名流程后才能恢复一键推送。不要让旧推送流程覆盖已签名的 `data-manifest.json`。
