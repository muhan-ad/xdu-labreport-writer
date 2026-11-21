# 0.70.0 安卓 AI 报告、绘图与请求通道验收

2026-10-27，当前模拟器 emulator-5560，安装包保持 0.70.0 / code 73。本轮没有修改应用源码或重新打包。

## 思考题和润色

`node scripts/accept-native-report-ui.mjs --ai` 在既有五项报告界面流程基础上补充三项检查，总计八项通过：

- 使用真实样本计算上下文、技能和知识资料构造请求；仅在 Native LabAI 完成请求处返回本地模拟回答。
- 自定义思考题返回后，经导入核对、本机保存及重新生成，实际 DOCX 和 Android 报告预览均包含该回答。
- 润色以刚生成报告的“实验方法”为原文，模拟返回保留原文并加测试标记；核对导入后重新生成，同时保留已导入的思考题。
- 两条结果均保存到原生历史文件并可在界面查看。最终 DOCX ZIP/XML 校验通过，47 个实际公式与生成元数据一致，两个测试标记均存在。

证据：`artifacts/verification/native-report-ui-0.70.0-1793073289255/`，含最终 DOCX、document-checks.json、ai-details.json。

## AI 绘图

`node scripts/accept-native-report-ui.mjs --plot` 在基础报告流程上补充两项检查，总计七项通过：

- 本地模拟模型返回绘图代码；真实 Android WebView 的隔离 Python 环境运行代码，读取本次样本并绘制负坐标侧/正坐标侧两条曲线。
- 图片预览成功时尚未自动采用；点击“采用”后保存至原生目录，重新生成的报告包含 AI 图注及图片，并保留原始照片和原有图表。
- DOCX ZIP/XML 校验通过，48 个公式与元数据一致，三个媒体文件存在；已解出并检查实际 AI 曲线图片。报告预览也包含图注和至少三个图像。

证据：`artifacts/verification/native-report-ui-0.70.0-1793073516750/`，含 ai-plot-report.docx、plot-details.json、document-checks.json 和实际媒体图片。

## 安卓实际 HTTP 通道

`node scripts/accept-native-ai-transport.mjs` 使用真正 LabAIPlugin 与本机 HTTP 模拟服务，通过 adb reverse 连接仅调试包允许的 `127.0.0.1:58440`。使用随机临时假密钥和 draft/test 接口，不执行 configure/clear，不替换已有配置。七项通过：

1. 真正请求到达本机 `/chat/completions`，携带预期临时令牌及模型名。
2. HTTP 401 返回中文提示，不透传服务端正文。
3. HTTP 302 拒绝跳转，没有向目标 `/stolen` 发送请求或令牌。
4. 空回复返回 EMPTY，不作为有效结果。
5. 回复回显临时令牌时替换为“密钥已隐藏”。
6. 正在进行的原生 HTTP 请求可取消，返回 CANCELLED。
7. 请求前后持久问答配置状态完全一致。

证据：`artifacts/verification/native-ai-transport-1793073688623/`。实际发生六次本机模拟 HTTP 请求、零付费请求、零持久 API 配置写入。测试结束关闭模拟服务并移除端口转发。

## 数据隔离和剩余边界

报告和绘图界面测试使用唯一临时文件命名空间，仍走真实 Android 文件插件、Repository、报告 Worker 和图片隔离环境。测试后删除临时目录并恢复原生桥接、重新加载应用。原有 209 个应用数据文件与更新前备份逐字节相同，三份非 WebView 偏好配置文件也完全一致。

没有真实学校操作、报告上传、反馈贡献或付费模型调用。界面测试的模型回复是模拟的；真实请求通道测试也只连接本机服务，不能证明任一外部服务商的可达性、计费、识图准确率、回答/绘图/润色质量。手机/平板真机、WPS 渲染、后台和系统中断恢复及 iOS 原生等仍未完成。不能把本轮局部验收称为全部移植完成。
