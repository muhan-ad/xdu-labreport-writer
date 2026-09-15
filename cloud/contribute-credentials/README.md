# 投稿与反馈云函数（1.7.6 协议）

## 部署

使用受平台支持的 Node.js 运行时。代码零外部依赖，不需要安装 COS SDK。函数环境变量：`SECRET_ID`、`SECRET_KEY`、`BUCKET`、`REGION`。密钥只留在云端，使用仅能写贡献目录的专用 CAM 身份。

配置 HTTPS POST 入口，把网关可信来源 IP 传入 `requestContext.sourceIp` 或 `requestContext.identity.sourceIp`。函数不信任客户端提交的 IP 请求头；缺少可信来源时拒绝签发。

新协议：

```json
{"files":[{"key":"contributions/feedbacks/20260915/feedback.json","size":128}]}
```

同时支持 `contributions/variants/<实验>/<批次>/<文件>`、`contributions/reports/<实验>/<批次>/<文件>` 和 `contributions/feedbacks/<批次>/<文件>`。云端将批次替换成随机 UUID；响应 `key` 保留原请求标识供客户端对应，`objectKey` 是实际对象名。

允许 json/docx/jpg/jpeg/png；单文件最多 20MB，单批次最多 20 个文件、总计 40MB。签名绑定 PUT、对象路径、Content-Type、Content-Length 和 `x-cos-forbid-overwrite: true`，有效期 600 秒。客户端上传必须带同样的请求头。变更大小会导致签名不匹配。

## 必须配套的生产控制

1. CAM/桶策略仅允许写 `contributions/*`，不允许写 `latest.json`、实验 ZIP、数据清单或读取其他用户对象。
2. 使用 `cos:content-length` 条件约束上限，并要求 `cos:x-cos-forbid-overwrite`。该防覆盖头在开启对象版本控制的桶中不起相同作用，部署时需验证实际桶设置。
3. **网关/WAF 或共享存储实现跨实例限流与每日累计配额。** 代码中的每 IP 每小时 20 批/100MB 只是单个热实例的补充保护；冷启动和横向扩容会重置/分散计数，不能替代分布式配额。
4. 投稿前缀禁止公开读取，配置审核、恶意文件隔离、未完成/过期投稿清理及费用告警。上传白名单和签名不等于文件内容已安全。
5. 如果来源在校园 NAT 后集中，请按实际使用人数调整分布式限流；不要为放开使用而取消大小和路径约束。

参考：[COS 条件键与限制大小](https://cloud.tencent.com/document/product/436/71307)、[PUT Object 防覆盖条件](https://intl.cloud.tencent.com/ind/document/product/436/7749)。

## 上线验收

测试三种合法投稿、反馈内容在管理端可读、超大/越界/重复 key 拒绝、短时批量请求被限流、签名头篡改失败及部分上传的过期清理。凭证有期限不代表已上传对象自动删除。

本目录代码更新不表示云端已经部署。须在发布客户端前部署，否则客户端会报告凭证协议不兼容。旧客户端 `keys` 协议不再受支持，版本升级提示需同步发布。
