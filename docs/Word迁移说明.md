# Word COM → python-docx + OMML 迁移说明

> 迁移日期：2026-09-18 ｜ 影响范围：报告生成底层（`物理实验/实验脚本/common/`）+ 主进程 Word 相关逻辑
> 目标：摆脱对 Microsoft Word 的依赖，修掉用户在最后一步（公式 `BuildUp()`）失败的问题，并把生成速度提升一个量级。

## 一、为什么要迁移

旧实现通过 `win32com` 遥控本机安装的 Word：新建文档 → 逐条写入 → 用 `OMaths.Add()` + `BuildUp()` 把 UnicodeMath 线性格式转成专业公式 → 另存为 .docx。

三个无法回避的问题：

1. **`BuildUp()` 在部分 Word 版本上直接失效**。表现为公式不转换、以线性文本（带反斜杠命令）留在文档里；旧代码用 `_assert_buildup_ok` 事后断言，于是生成流程整体抛错退出——用户看到的就是"最后一步失败"。实测本机 Word 版本对 `\frac`、`\pm`、`\times`、`\bar` 等常用命令均无法构建，**两个实验连续复现失败**（薄透镜焦距的测量、长度与体积的测量）。
2. **必须有 Word**。学校正版化平台装不到、或装的是 WPS 的用户直接无法使用。
3. **慢且脏**。启动 Word 约 16～33 秒/份；还要处理 Word 进程归属、临时锁文件、弹窗抢焦点、取消时清理实例等一堆系统级副作用（`src/main/word-probe.py`、`word-process.js`、`.LAB_WORD_INSTANCE` 协议、PID 差集清理都为此存在）。

## 二、新管线

```
LaTeX → MathML → OMML → 写入 docx（python-docx）
        └ latex2mathml ┘ └ mathml2omml ┘
```

- `common/docx_omml.py`：公式转换模块。纯 Python 依赖（`latex2mathml` 3.81.1 + `mathml2omml` 0.0.2，均 MIT），可随内置运行时打包。
- `common/docx_report.py`：重写为 `python-docx` 实现，**公开接口与旧版完全一致**（`add_title` / `add_math` / `add_inline_math` / `add_table` / `add_image` / `add_data_photo` / `save` / `close` …），26 个实验的 `generate.py` 一行未改。

### 转换链路上踩到的三个坑（都已在代码里处理）

| 问题 | 现象 | 处理 |
|---|---|---|
| `mathml2omml` 0.0.2 的 `groupChr` 模板闭合标签写错 | `\bar`、`\underline` 等重音公式产出**非法 XML**，Word 判定文档损坏拒绝打开（不是渲染问题，是文件级错误） | `_repair_groupchr()` 精确修复（语料实测修复 136 处） |
| 重音/划线被映射成"上下限对象" | `\hat`、`\tilde`、`\dot`、`\overline`、`\underline` 全被 `mathml2omml` 生成为 `m:limUpp` / `m:limLow`，`\bar`、`\vec` 生成为 `m:groupChr`。Word 会把重音按**整字号的限位字符**排版（`\hat{x}` 变成压在字母上的大 `^`），可伸缩组字符则会拉伸字符宽度——与 Word 公式编辑器的观感明显不符 | `_normalize_accents()`：重音改写为 **`m:acc`**（组合重音符居中压在基上）、上下划线改写为 **`m:bar`**（画真正的横线），`\lim` / `\underset` 这类真限位保持不动（只改写限位槽恰为单个重音字符的情况） |
| 根号缺少 `<m:deg/>` 度数占位 | `\sqrt` 生成的 `<m:rad>` 只有 `<m:e>`，Word 能正常打开，但**应用内预览（docx-preview）会整篇渲染失败并回退成纯文本**——典型的"Word 能开、预览崩" | `_ensure_rad_degree()` 按 Word 的结构补上空 `<m:deg/>`（嵌套根号逐层补） |
| 只起分组作用的 LaTeX 环境（`\begin{aligned}` 等） | 转换器直接抛 `SAXParseException`，公式退化成乱码文本（`beginaligned …`）；AI 润色改写时很常见 | `_normalize_environments()` 剥离环境标记、去掉对齐符 `&`、行分隔 `\\` 当作逗号 |
| 未替换的 `%%DATA:%%` 占位符进了公式 | `%` 是 LaTeX 注释符，会把后面内容整段吃掉，**转换还"成功"** | 检测到占位符直接判失败并告警 |
| 同类上下标连写 `T_{0}_i` | 非法 LaTeX，转换器抛异常，公式退化为纯文本 | `_merge_double_scripts()` 合并为 `T_{0i}` |
| **富文本里的内联公式被写进了另一段**（光标语义） | `add_paragraph_rich` 创建段落后没有把"写入光标"指向它，于是 `$...$` 内联公式落到独立段落里：**文字与公式被拆开**，十几条公式连成一行顶出页面（实测越界 419pt，观感"排版乱"）。旧实现靠 Word 的 Selection 停在文档末尾，天然不会出现 | `_add_paragraph` 统一把 `_cursor` 指向新建段落，恢复"光标停在最后一段"的旧语义；`omml_test` 增加断言（内联公式必须与同段文字在同一 `<w:p>`），并做过注入验证 |
| **超宽公式顶出页面** | Word **不会在公式内部折行**（实验证实：内联、显示两种写法同样整块不可断），`u(V)=√(...)` 这类长公式在 12pt 下宽 553pt > 版心 415pt | `fit_math_width()` 按可用宽度自动缩放整条公式（系数 0.70 em/字符，由 12 条真实公式标定；下限 7pt）；独立公式按"版心−缩进"算可用宽度，表格内公式按列宽算 |
| 表格宽度设置静默失效 | python-docx 模板自带 `<w:tblW w:type="auto" w:w="0"/>`，直接 append 会出现两个 tblW，Word 只认第一个 → "撑满版心"的设置从未生效 | `_set_tbl_width_pct()` 先删旧的、再按 OOXML 顺序插到 `tblBorders` 之前 |
| 改写后基座被包了两层 `<m:e>` | XML 合法但 OMML 结构非法，Word 报"打开文件时遇到错误" —— 只查 XML 合法性查不出来 | `_wrap_e()`：基座已是 `<m:e>…</m:e>` 时不再包一层（由 `tests/word_report_test.py` 的 Word 实物验收兜住） |

此外每条 OMML 在写入前都做 **XML 合法性校验**：不合法宁可回退为文本并打印告警，也绝不写进文档。

## 三、排版对齐

旧管线的排版参数（用 Word 实测导出）作为基线，新实现逐项对齐：

| 项目 | 基线（旧） | 新实现 |
|---|---|---|
| 纸张 / 页边距 | A4 595.3×842.0 pt，上72 下72 左90 右90 | 一致（Cm(21)×Cm(29.7)，Pt(72/72/90/90)） |
| 标题 | 黑体 16pt 加粗居中，段后 12 | 一致 |
| 一级 / 二级标题 | 黑体 14pt / 12pt 加粗，段前 12/6、段后 6/3 | 一致 |
| 正文 | 宋体 12pt，首行缩进 21pt | 一致 |
| 行距 | 13.9pt（多倍行距） | 一致（278/240 倍） |
| 表格 | 宋体 10pt 居中、表头加粗、全边框、整表居中撑满正文宽 | 一致 |

有一处**有意的差异**：旧实现里标题会从上一段继承首行缩进（正文后的一级标题带 21pt 缩进、标题后紧跟的正文字段则不带），属于历史遗留的不一致；新实现对标题固定 0 缩进。

## 四、验证方式

| 层次 | 手段 | 结果 |
|---|---|---|
| 公式转换 | `python tests/omml_test.py`：26 个实验全部 `$...$` 公式（含 `generate.py` 里硬编码的）逐个转换 + XML 合法性 + 数字保留检查 | **4736 条，0 失败** |
| 文档结构 | 同上阶段 2：生成含行内/独立/表格公式与根号的 docx，解压校验 OMML 元素、根号度数占位与正文无 LaTeX 残留 | 通过（不依赖 Word） |
| 端到端 | 26 个实验全量 `generate.py` | **26/26 成功，零告警**，合计约 38 秒（旧版单份 16～33 秒） |
| Word 实物验收 | 用 Word 逐个打开 26 份报告，统计公式对象数、检查线性残留与正文 LaTeX 命令 | **26/26 通过**：公式 8～58 个/份，残留 0，正文命令 0 |
| 应用内预览 | 用真实 Chromium（Electron）把 26 份报告喂给 docx-preview 渲染 | **26/26 通过**（数学节点 107～1859 个/份） |
| 整体链路 | `npm run test:desktop`（真实 Electron：IPC → OCR 原图 → Python 生成 → 文档预览） | 5/5 通过 |
| **版式越界（渲染级）** | 导出 PDF 后统计超出正文区的墨迹（>525pt 判真越界，排除中文标点悬挂） | **26 个实验真越界字符 0 个**；`tests/word_report_test.py` 内置逐行越界断言 |

`tests/omml_test.py` 已加入 `npm run verify`，因此**公式回归在 CI/提交前就能跑，不再需要 Word 环境**。
另有 `tests/word_report_test.py` 作为**可选的 Word 实物验收**（有 Word 的机器上运行；无 Word 自动跳过）：
生成一份报告并用 Word 打开，断言公式对象数 > 0、无线性残留、正文无 LaTeX 命令——
这一步能抓到"XML 合法但 OMML 结构非法"这类只有 Word 才判得出来的问题。

## 四之二、与交接文档《问题清单与改造方案》的对照

`实验搭子-问题清单与改造方案（python-docx+OMML）.md` 描述了同一目标的另一条实现路线（手写 LaTeX→OMML 编译器），两份实现互为印证。差异与取舍如下：

| 维度 | 交接文档（原型路线） | 本实现 |
|---|---|---|
| LaTeX→OMML | 手写编译器约 230 行，零新增依赖 | 复用 `latex2mathml` + `mathml2omml`（MIT，已内置），**同样零安装负担** |
| 未知/异常构造 | 抛错，作为构建期硬错误 | 逐条转换 + **XML 合法性校验**；单条失败回退为文本并打印告警，**整份报告不会因此流产**（AI 润色是运行时输入，硬错误会让用户拿不到报告） |
| 独立公式段 | 与正文同为缩进段、不居中 | 已对齐：首行缩进 21pt + `m:jc=left`，与旧产物一致 |
| 表格后补空段 | 明确要求（否则相邻表格会被 Word 合并） | 已实现（`add_table` 末尾补空段） |
| run 合并 | 明确要求 | 未合并（仅影响 XML 体积，不影响渲染） |
| 语料覆盖 | 4642 条 + 运行时 654 条 | 4736 条（含 `generate.py` 内硬编码公式）+ 43 条"野生 LaTeX"（`aligned`/`underset`/`cases`/`operatorname` 等） |
| 额外修掉的坑 | — | 库的 3 处缺陷（groupChr 非法 XML、根号缺 `<m:deg/>` 导致预览整篇崩、重音误用 limUpp/limLow） |

两份文档共同指出的"整份报告靠 Word 逐字打字"这一根因、以及 26 个 `generate.py` 零改动即可切换的结论，均已在本实现中验证。

**交接文档中尚未处理的条目**（超出本次 Word 迁移范围，建议按其中优先级单独立项）：P13/P14（资源更新事务）、P19/P20（不确定度口径不一致，会写进学生报告）、P24（生成失败仍 `exit 0`）、P32/P34~P36（运行时与发布流程）。
其中 **P33（`.mimosa` 打包泄漏）已顺手修掉**：`package.json` 的 `files` 与 `物理实验` filter 均加入 `!**/.mimosa/**`。

## 五、清理掉的 Word 冗余

- 删除：`src/main/word-probe.py`（Word 环境探测）、`src/main/word-process.js`（按 PID+HWND 结束 Word 实例）、`tests/word_smoke.py`、`tests/word_integration.js`、`tests/formula_build_test.py`（BuildUp 回归）。
- `main.js`：移除 `.LAB_WORD_INSTANCE` 日志协议、`job.wordHandles`、取消生成时的 Word 清理分支；诊断里的 `probeWordEnv()` 换成 `probeRuntimeEnv()`（只报 Python 版本与系统代码页/区域，编码排查仍然可用）。
- `src/main/diagnostics.js`：删除「Word 环境检测」整段，改为「生成环境」。
- 依赖：`pywin32` 从 `物理实验/requirements.txt` 与 `requirements-runtime.txt` 移除；公式转换依赖 **`latex2mathml` + `mathml2omml`（纯 Python、MIT）已内置**到 `物理实验/实验脚本/common/_vendor/`（见第六节）。

## 六、依赖内置与发布方式

### 6.1 为什么要内置，而不是装进运行时

公式转换依赖两个纯 Python 包。若走"装进随包 Python 运行时"的路线，每次依赖变动都要重建 205MB 的 `python-runtime/`（该运行时不入库，且目前没有重建脚本），一旦漏做，用户端就是 `ModuleNotFoundError`。

因此把两个包**内置进资源目录**：`物理实验/实验脚本/common/_vendor/{latex2mathml,mathml2omml}/`（约 450KB，含版本与 MIT 许可说明）。

- `common/docx_omml.py` 导入时把 `_vendor` 插到 `sys.path` 最前 → **版本固定、各机器行为一致**；内置副本缺失时才退回运行时里 pip 安装的版本；
- 两处都没有时抛出的错误里直接带了修复命令，不再是裸 `ImportError`；
- **不需要重建 Python 运行时**，也不需要用户装任何东西；
- 内置副本随 `物理实验` 目录分发，因此**可被数据包热更新覆盖**——公式层面的修复不必等应用发版。

升级依赖的方式：`pip install -U latex2mathml mathml2omml && python scripts/vendor-math-deps.py`
（脚本会重新拷贝并自动打上 `latex2mathml/__init__.py` 的版本号容错补丁——该文件在导入时读包元数据，内置后没有分发元数据会抛 `PackageNotFoundError`。）

> **内置依赖踩到的坑（已修）**：资源同步的 `resourceFiles()` 原先只认 `.py|.json|.md` 三种扩展名，
> 于是 `unimathsymbols.txt`（216KB 符号表）**既不参与版本指纹、也不会同步到用户数据目录**——
> 表现是"命令行跑得好好的，应用里一生成就 `FileNotFoundError`"（`npm run test:desktop` 抓到的）。
> 已把白名单抽成 `RESOURCE_FILE_RE`（加入 `txt/csv/ttf/otf/dat`）并补了回归测试
> （`tests/regression.test.js`：数据文件必须同步、内容变化必须改变指纹）。
> **以后新增非脚本类资源时务必同步这个白名单**，否则数据包也永远下发不了这类文件。

### 6.2 这条链路可以走数据包热更新

报告写入器（`common/docx_report.py`、`common/docx_omml.py`、`_vendor/`）**全部位于 `物理实验/实验脚本/` 内**，而该目录正是数据包热更新的覆盖范围。26 个 `generate.py` 不再 import `win32com`（已确认全仓无引用）。

因此本次迁移的**功能部分可以只发一个数据包**（无需应用版本升级）；应用侧改动（`main.js`/`renderer.js`/`diagnostics.js` 去掉 Word 逻辑、帮助文案）只影响提示与诊断，可以随后随版本发出。

> 注意交接文档提到的发布顺序陷阱（数据包 `minAppVersion` 绑定主仓库版本号）：若只发数据包，主仓库版本号不要先行 bump。

## 七、报告内容规范（课程取位 + 公式排版）

内容层面的两类缺陷（「公式只有符号式、没有数值代入」「结果没有写成 x = (a ± b)」）与排版无关，
是脚本里怎么组织文字/公式的问题。约定如下，26 个实验按此逐批整改。

### 7.1 不确定度取位（课程 2-4）

| 规则 | 实现 |
| --- | --- |
| 绝对不确定度取 1 位有效数字，**只进不舍** | `format_uncertainty(u)` / `format_measure(v, u)` |
| 测得值末位与不确定度对齐（四舍六入五凑偶） | `format_measure(v, u)` |
| 相对不确定度取 1~2 位（首位 ≥3 取 1 位、1/2 取 2 位，只进不舍） | `format_percent(p)` |

`format_measure(v, u)` 直接给出 `(0.640 \pm 0.004)`、`(1.88 \pm 0.02) \times 10^{-3}` 这类标准写法
（量级过小/过大自动提出 10 的幂），单位由调用方补 `\text{ mm}`。

**变体文本的坑**：`variants.json` 的 `%%DATA:key:%.3f%%` 只能写固定格式，既表达不了取位规则，
也会和正文的 ± 写法打架（同一份报告里正文写 `V=(4.68±0.02)×10³ mm³`、结论写 `V=4683.7±17.6 mm³`）。
因此这类量在脚本里**预格式化**成字符串，变体改用 `%%DATA:key:%s%%` 引用
（示例：`Y_pm`、`B_pm`、`V_pm`、`uD_s`）。另注意 `%.3e` 会输出 `1.891e-03` 这种机器计数法，
应改用 `format_scientific()` 预格式化。

### 7.2 公式里的单位与百分号（转换器自动规范化）

`common/docx_omml.py` 的 `_preprocess()` 在送进转换器前做三件事，避免静默丢内容：

1. **裸 `%` 转义**：LaTeX 里 `%` 是注释符，`0.4%` 会被吃成 `0.4`；统一转成 `\%`。
2. **「数值 单位」补间距并改正体**：数学模式丢弃空格，`0.973 m` 会渲染成 `0.973m`；
   识别常见单位后改写成 `\ \text{mm}`（不间断空格 + 正体）。
3. **`\,` 之类的细空格同样会被丢弃**（`0.00806\,\mathrm{cm}` → `0.00806cm`），一并换成不间断空格。

改完后全量复验：4737 条公式 0 转换失败、26 份报告 0 真越界（PDF 墨迹测量），
公式内「数字紧贴单位」由 293 处降到 55 处（剩余为 Ω 紧贴与 `T_1^2` 这类上标误报）。
新增正则都带单位白名单，`2d/N` 这类正常紧凑写法不受影响。

### 7.3 体检脚本与当前基线

```bash
python scripts/audit-report-content.py                 # 全部实验，打印表格
python scripts/audit-report-content.py --exp 拉伸法测量钢丝杨氏弹性模量
```

判据：算了 `u(x)=…`（后面跟数字）却没有 ± → 结果没写成标准形式；`±` 条数少于 `u(x)=` 式条数 → 只补了一部分；
另有「纯符号公式（有等号、无数字）」条数反映有没有数值代入过程（>5 条报警）。

2026-09 基线：26 个实验中 **9 个全文无 ±**（RLC、光的偏振、理想气体、伏安特性、电容与高电阻、电表改装、
直螺线管→已修、重力加速度、霍尔效应）、**3 个 ± 少于数值不确定度式**（低电阻、灵敏电流计、长度与体积→已修）。
已按样板整改：**拉伸法（含物理 bug：Y 原先用未修正直径）、直螺线管、激光波长、长度与体积**。
其余实验需要按各自物理量逐个判断（很多是作图法/拟合类，要不要给 ± 得人看），留给分工核对。
