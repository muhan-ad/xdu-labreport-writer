# AI 响应完成状态核对

0.110.0 修正 Android AI 通道对模型输出结束状态的处理。此前流式响应只拒绝 length 和 content_filter，可能把 aborted、insufficient_system_resource 或工具调用的部分正文当作完整结果；普通 JSON 响应则未检查结束原因。这影响问答、报告润色、绘图和非流式识图。

现在明确的非正常结束状态会返回错误；未支持的工具调用也不会当作正文。流式过程中可能短暂显示已收到的预览，但失败后不会把部分内容交给导入流程。正常 stop 及缺省结束状态的兼容 JSON 响应保留支持；缺省状态无法独立证明模型确实完整输出。DeepSeek 官方对结束原因的定义参见 https://api-docs.deepseek.com/api/create-chat-completion/ 。

验证使用独立模拟器验收应用、临时密钥及本机模拟服务器，没有访问真实模型、付费服务或学校写接口。原生接口测试涵盖问答和识图的五种非正常 JSON 状态、三种流式状态，以及正常和缺省兼容响应；实际界面 8 项覆盖中断后禁止导入、普通 JSON、流式预览、停止、润色和绘图。新增原生单元测试先复现 aborted 等被错误接受，再验证修复。388 项领域测试和安卓调试构建通过。

证据：artifacts/verification/ai-finish-before.log、ai-finish-after.log、native-ai-finish-1793234950844/、native-ai-finish-ui-1793234977831/、build-0.110.0.log。以上文件位于 artifacts/verification/。验收后模拟器已离线，不能声明 0.110.0 已覆盖安装；iOS 仅同步共享资源，本次 Android 原生修复不代表 iOS 已接入或验证。
