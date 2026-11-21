# AI 绘图独立执行环境（0.15.0 开发中）

已新增 `runIsolatedPlot`：当前实验的 Python 代码与测量数据先经过长度检查；本机运行库按清单核对大小和 SHA-256，再转移到独立 iframe 的一次性 Worker。此环境只收到当前数据、代码、绘图库和字体，不收到账号、API Key、原生接口、完整报告源码或其他实验记录。

## 边界

iframe 使用 `sandbox="allow-scripts"`，不启用同源权限。构建时为可信转发脚本生成 CSP 哈希；`default-src 'none'`、`connect-src 'none'`、`worker-src blob:`，只允许相应脚本哈希、Blob 脚本与 WASM 编译。模型代码在 Worker 执行，不在 iframe 文档或主页面执行。执行后的结果只能经 MessageChannel 返回受限的进度、错误、PNG 和图注，不接受打开网址、原生文件或账号操作。

Worker 初始化所需资源由父页面提前读取并校验，只提供 numpy/matplotlib/pillow 依赖闭包，不装载 lxml、python-docx 或报告源码。Worker 的资源读取接口只返回已提供的离线文件。运行后移除 iframe、关闭端口，成功、失败、取消或超时均执行清理；PNG 返回主页面前先检查文件头、尺寸和体积。

AST 检查仍仅是减少误用的辅助措施，隔离边界来自浏览器环境和 CSP。没有把 Python 属性过滤称为可靠沙箱，也没有把几个负例当成所有引擎漏洞的安全证明。

## 已验证

`node scripts/test-ai-plot-browser.mjs` 在新建的专用桌面无头 Chrome 中运行，未使用用户现有浏览器配置或账号：

1. 实际在独立环境加载本机 WASM、运行绘图代码并返回有效直螺线管 PNG，下标图注保留。
2. 在同一 iframe/Worker 架构中用直接 JavaScript 探测 fetch、WebSocket、importScripts 和非 Blob 子 Worker。HTTP 请求及 WebSocket 握手均计数，服务器实际收到 **0** 次探测请求；Worker 没有 document 或测试所检查的页面/原生桥对象。
3. 取消已开始运行的 Python 死循环后返回“绘图已取消”，主页面保持响应，iframe 清理完成。
4. 整体超时返回中文错误，iframe 清理完成。
5. Python 语法错误正确返回，iframe 清理完成。

5 项通过，测试进程、测试浏览器和静态服务器已正常退出；结果没有未捕获异常。第一次测试的 Vite 开发服务器关闭流程卡住，已改为构建测试客户端后使用专用只读静态服务器，再完整复验通过。

证据：`artifacts/verification/ai-plot-isolation/results.json`、`browser-solenoid.png`。当前 65 项领域测试、类型检查、前端构建及 38 项运行资源校验通过。

## 未完成

证据范围是桌面 Chrome，不能替代 Android WebView/iOS、不同设备内存和真实模型验收。后续源码已接入 AI 生成/核对/采用/插入报告 UI，组件及多尺寸证据见 [页面与插图验证](AI绘图页面与插图验证记录.md)；没有更换 0.14.0 安装包，也没有进行真实 API 调用、选退课或报告上传。

清理上一轮遗留的临时浏览器目录 `E:\tools\app-maker\browser-tests\plot-isolation-1792832201907` 时，自动审批只返回 `blocked by policy`，没有具体原因。删除命令未执行，目录保留，未采用其他方式绕过。该清理拦截不改变已经完成的浏览器测试结果。
