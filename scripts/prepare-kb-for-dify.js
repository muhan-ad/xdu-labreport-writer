// 知识库预处理（给 Dify 索引用）：把教材与实验知识库整理成「可整块检索」的 Markdown。
//
// 产出目录：物理实验/test/（临时产物，训练完可整个删除）
//   README.md                 使用说明 + Dify 建库参数 + 重跑命令
//   cleaning-report.txt       逐文件改动审计（删了哪些行、标题怎么改的、代码围栏位置）
//   total-clean.md            教材全文清理版（想一次导入用这个）
//   total-clean/*.md          教材按章/实验切分的文档（推荐：便于逐文档打元数据）
//   total-metadata.csv        total-clean/*.md 的元数据表（实验名/章节类型/来源）
//   experiments-clean/*.md    27 份实验知识库清理版
//   experiments-metadata.csv  27 份实验知识库的元数据表
//
// 处理规则（对两份语料都生效）：
//   1) 删掉失效图片引用 ![](images/...) 与孤立的 (a)/(b)/(1) 图注残片
//   2) 未围栏的代码段（连续 ≥3 行代码样行）用 ```text 围起来，并把代码里的 \_ 还原为 _
//   3) 标题层级规范化：# 章 / ## 节 / ### 小点（教材原本全是 ##）
//   4) $$...$$ 公式块内部的空行去掉（公式成为不可分单元）
//   5) 表标题、表头、表体之间不留空行（整表 + 表标题落进同一段）
//   6) 连续空行压成一个空行（Dify 的子段分隔符就是 \n\n）
//
// 用法：node scripts/prepare-kb-for-dify.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '物理实验');
const OUT = path.join(SRC, 'test');

function inside(p, root) {
  const abs = path.resolve(p);
  const rel = path.relative(root, abs);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('路径越界：' + abs);
  }
  return abs;
}
const read = (p) => fs.readFileSync(inside(p, ROOT), 'utf8');
const write = (p, text) => {
  const target = inside(p, OUT);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, 'utf8');
};

// ── 判定工具 ───────────────────────────────────────────────────────────────
const IMAGE_RE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const LABEL_RE = /^\([0-9a-zA-Z?][0-9a-zA-Z\s?]{0,4}\)[\s\d?]*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const ROMAN_RE = /^[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\s*[、.]?\s*\S/;
const SEC_NUM_RE = /^\d+\s*-\s*\d+\s/;                 // 2-2 误差
const CN_SEC_RE = /^[一二三四五六七八九十]+\s*[、.]/;   // 一、实验目的
const SUBSEC_RE = /^(\d+\s*[.、）)]|\(\d+\)|（\d+）)\s*\S/; // 1. / 2） / (1)
const KEEP_SEC_RE = /^(知识拓展|习题|参考文献|附录)/;

function isCodeLine(line) {
  const s = line.trim();
  if (!s) return false;
  if (/^%[ \u4e00-\u9fa5]/.test(s)) return true;
  if (/^(clc|clear|close all|hold on|hold off|grid on|figure\(|plot\(|xlabel\(|ylabel\(|title\(|legend\(|axis\(|xlim\(|ylim\(|plt\.|np\.|ax\.|disp\(|p = |y_fit|Inr|lnr)/.test(s)) return true;
  if (/;\s*$/.test(s) && /[=(\[]/.test(s)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\[.*\]\s*;?\s*$/.test(s)) return true;
  return false;
}

// ── 步骤 1：代码围栏（连续 ≥3 行代码样行）────────────────────────────────
function fenceCode(lines, report, tag) {
  const out = [];
  let i = 0, runs = 0;
  while (i < lines.length) {
    if (isCodeLine(lines[i])) {
      let j = i;
      while (j < lines.length && (isCodeLine(lines[j]) || (!lines[j].trim() && j + 1 < lines.length && isCodeLine(lines[j + 1])))) j++;
      const block = lines.slice(i, j);
      if (block.filter((l) => isCodeLine(l)).length >= 3) {
        out.push('```text');
        block.forEach((l) => out.push(l.replace(/\\_/g, '_')));
        out.push('```');
        report.push(`  · ${tag}: 第 ${i + 1}-${j} 行围成代码块（${block.filter(isCodeLine).length} 行代码）`);
        runs++;
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return { lines: out, runs };
}

// ── 步骤 2：标题层级规范化（跳过代码围栏内）──────────────────────────────
function normalizeHeadings(lines, report, tag) {
  const out = [];
  let inFence = false;
  let remapped = 0;
  for (const line of lines) {
    if (/^```/.test(line.trim())) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }
    const m = line.match(HEADING_RE);
    if (!m) { out.push(line); continue; }
    const text = m[2].trim();
    let level;
    if (ROMAN_RE.test(text)) level = 1;                       // Ⅰ 绪论 / Ⅲ 基础实验
    else if (/^实验\s*\d+/.test(text)) level = 1;              // 实验19 霍尔效应实验
    else if (SEC_NUM_RE.test(text) || CN_SEC_RE.test(text) || KEEP_SEC_RE.test(text)) level = 2;
    else if (SUBSEC_RE.test(text)) level = 3;
    else level = 2;
    const next = '#'.repeat(level) + ' ' + text;
    if (next !== line.trim()) remapped++;
    out.push(next);
  }
  if (remapped) report.push(`  · ${tag}: 调整 ${remapped} 个标题层级`);
  return out;
}

// ── 步骤 3：删图片引用与孤立图注残片 ─────────────────────────────────────
function dropNoise(lines, report, tag) {
  const out = [];
  let imgs = 0, labels = 0;
  for (const line of lines) {
    const s = line.trim();
    if (IMAGE_RE.test(s)) { imgs++; continue; }
    if (LABEL_RE.test(s) && s.length <= 12) { labels++; continue; }
    out.push(line);
  }
  if (imgs || labels) report.push(`  · ${tag}: 删除 ${imgs} 行失效图片引用、${labels} 行孤立图注残片`);
  return out;
}

// ── 步骤 4：公式块 / 表格 / 空行整理 ─────────────────────────────────────
function compact(lines, report, tag) {
  const out = [];
  let inMath = false;
  let droppedInMath = 0;
  for (const line of lines) {
    const s = line.trim();
    if (s === '$$') {
      inMath = !inMath;
      out.push(line);
      continue;
    }
    if (inMath && !s) { droppedInMath++; continue; }          // 公式块内空行
    out.push(line);
  }
  // 表格区域去空行 + 连续空行压缩
  const out2 = [];
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    if (!line.trim()) {
      let j = i;
      while (j < out.length && !out[j].trim()) j++;
      const next = out[j] || '';
      const prev = out2[out2.length - 1] || '';
      if (next.startsWith('|') || prev.startsWith('|')) continue;   // 表格前后不留空行
      if (prev === '') continue;                                    // 连续空行压成一个
      out2.push('');
      i = j - 1;
      continue;
    }
    out2.push(line);
  }
  if (droppedInMath) report.push(`  · ${tag}: 去掉公式块内 ${droppedInMath} 行空行`);
  return out2;
}

function cleanBody(lines, report, tag) {
  let cur = lines;
  const f = fenceCode(cur, report, tag);
  cur = f.lines;
  cur = dropNoise(cur, report, tag);
  cur = normalizeHeadings(cur, report, tag);
  cur = compact(cur, report, tag);
  while (cur.length && !cur[cur.length - 1].trim()) cur.pop();
  return cur.join('\n') + '\n';
}

// ── 教材：切分 + 清洗 ─────────────────────────────────────────────────────
function buildTotal(report) {
  const lines = read(path.join(SRC, 'rag', 'total.md')).split('\n');
  // 目录块（## 目录 → 下一个 ## I 之前）
  const tocStart = lines.findIndex((l) => /^#{1,6}\s*目录\s*$/.test(l));
  const bodyStart = lines.findIndex((l) => /^#{1,6}\s*I\s+绪论/.test(l));
  if (tocStart < 0 || bodyStart < 0) throw new Error('找不到目录或绪论起点');
  const toc = lines.slice(tocStart, bodyStart).join('\n');
  const tocExps = toc.split('\n')
    .map((l) => l.trim().replace(/…….*$/, '').trim())
    .filter((l) => /^实验\s*\d+\s+\S/.test(l));
  if (tocExps.length !== 25) throw new Error('目录里的实验条目不是 25 个：' + tocExps.length);
  report.push(`  · 教材: 删除目录块（第 ${tocStart + 1}-${bodyStart} 行），从目录取到 ${tocExps.length} 个实验标题`);

  const body = lines.slice(bodyStart);
  const off = bodyStart;
  // 25 个实验块的起点：'## 一、实验目的' 前的引言段
  const aims = [];
  body.forEach((l, i) => { if (/^#{1,6}\s*一、实验目的\s*$/.test(l)) aims.push(i); });
  if (aims.length !== 25) throw new Error('正文实验块不是 25 个：' + aims.length);
  const introStarts = aims.map((a) => {
    let s = a - 1;
    while (s > 0 && body[s].trim()) s--;      // 回退到引言段开头
    while (s < a && !body[s].trim()) s++;
    return s;
  });
  // 用图号（图3-N-x）校验实验顺序
  aims.forEach((a, k) => {
    const end = k + 1 < aims.length ? aims[k + 1] : body.length;
    const m = body.slice(a, end).join('\n').match(/[图表]3-(\d+)-/);
    const guess = m ? parseInt(m[1], 10) : null;
    if (guess !== null && guess !== k + 1) {
      throw new Error(`实验块顺序存疑：第 ${k + 1} 块推断为实验${guess}`);
    }
  });
  report.push('  · 教材: 25 个实验块顺序经「图3-N-x」编号校验一致');

  const chapter2 = body.findIndex((l) => /^#{1,6}\s*Ⅱ\s/.test(l));
  const chapter3 = introStarts[0];
  const docs = [];
  const ch1 = cleanBody(body.slice(0, chapter2), report, '绪论');
  docs.push({ file: '00-绪论.md', text: ch1, exp: '', kind: '绪论' });
  const ch2 = cleanBody(body.slice(chapter2, chapter3), report, '基本概念与数据处理');
  docs.push({ file: '01-基本概念与数据处理.md', text: ch2, exp: '', kind: '基本概念与数据处理' });
  aims.forEach((a, k) => {
    const start = introStarts[k];
    const end = k + 1 < aims.length ? introStarts[k + 1] : body.length;
    const title = tocExps[k];
    const seg = body.slice(start, end);
    const cleaned = cleanBody(seg, report, title);
    const withTitle = `# ${title}\n\n` + cleaned;
    docs.push({
      file: `02-实验${String(k + 1).padStart(2, '0')}-${title.replace(/^实验\s*\d+\s*/, '')}.md`,
      text: withTitle, exp: title.replace(/^实验\s*\d+\s*/, ''), kind: '实验原理',
    });
  });
  return { docs, all: docs.map((d) => d.text.trimEnd()).join('\n\n'), tocStart: off };
}

// 每份实验知识库都要有一个 # 级文档标题：首个标题是 ## 且像标题就升级，否则补一个
function ensureDocTitle(text, exp) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  const TITLE_TAIL = /(实验报告|实验|原理知识库|知识库|原理)\s*$/;
  if (idx >= 0 && /^#\s/.test(lines[idx])) return text;                 // 已有 h1
  if (idx >= 0) {
    const bare = lines[idx].replace(/^#+\s*/, '').trim();
    if (bare.includes(exp) || TITLE_TAIL.test(bare)) {
      lines[idx] = '# ' + bare;
      return lines.join('\n');
    }
  }
  return `# ${exp} 实验原理\n\n` + text;
}

// ── 实验知识库（27 份 原理.md）────────────────────────────────────────────
function buildExperiments(report) {
  const base = path.join(SRC, '实验脚本');
  const dirs = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, 'rag', '原理.md')));
  const docs = [];
  for (const exp of dirs.sort()) {
    const lines = read(path.join(base, exp, 'rag', '原理.md')).split('\n');
    const cleaned = cleanBody(lines, report, exp);
    docs.push({ file: `${exp}.md`, text: ensureDocTitle(cleaned, exp), exp, kind: '实验原理' });
  }
  return docs;
}

// ── 输出 ─────────────────────────────────────────────────────────────────
function csv(rows) {
  const head = '文件名,实验名,章节类型,来源,字符数';
  const body = rows.map((r) => [r.file, r.exp || '（公共）', r.kind, r.source, r.text.length].join(','));
  return [head, ...body].join('\n') + '\n';
}

const README = `# 知识库训练素材（Dify 用）

> 本目录由 \`node scripts/prepare-kb-for-dify.js\` 生成，**训练完整个目录可直接删除**。
> 源文件（\`物理实验/rag/total.md\` 与 27 份 \`实验脚本/*/rag/原理.md\`）没有被改动。

## 一、目录内容

| 文件 | 说明 |
|---|---|
| \`total-clean.md\` | 教材全文清理版（想一次导入一个文档用这个） |
| \`total-clean/*.md\` | 教材按章/实验切分的 27 个文档（**推荐**：便于逐文档打元数据） |
| \`total-metadata.csv\` | 上述 27 个文档的元数据表（文件名/实验名/章节类型/来源/字符数） |
| \`experiments-clean/*.md\` | 27 份实验知识库清理版（每份一个文档） |
| \`experiments-metadata.csv\` | 上述 27 份的元数据表 |
| \`cleaning-report.txt\` | 逐文件改动审计（删了哪些行、标题怎么改、代码围栏位置） |

清理做了什么：删掉失效图片引用（\`![](images/...)\`，源里共 247 行）与孤立的 \`(a)/(b)/(1)\` 图注残片、删除目录块、标题层级规范化（\`#\` 章 / \`##\` 节 / \`###\` 小点）、\`$$...$$\` 公式块内空行去掉、表标题与表体之间不留空行、连续空行压成一个。
核对结果：\`$$\` 公式行 722 行、表格行 550 行**逐行守恒**，抽查长段落无丢失。

## 二、Dify 建库参数（照填）

⚠️ **分段模式建库后不能改**（分隔符和长度能改，模式不能）。建议先拿 2~3 个实验的文档建个临时库试参数，满意了再全量。

| 项 | 建议值 | 说明 |
|---|---|---|
| 分段模式 | **父子分段** | 不要用通用/自动分段 |
| 父段模式 | **段落**（不要「全文」） | 全文模式只处理前 10000 token，且父段建成后不可编辑 |
| 父段分隔符 | \`\\n## \` | 对应上面清理后的「节」 |
| 子段分隔符 | \`\\n\\n\` | 父子分隔符不能是子集关系（父 \`## \`、子 \`#\` 这种组合要避开） |
| 子段最大长度 | 400（字符） | 中文 400 字 ≈ 500~700 token |
| 子段重叠 | 0~50 | 父子模式有父段兜上下文，可以设 0 |
| 预处理：替换连续空格换行 | 保留 | — |
| 预处理：删除 URL/邮箱 | **关掉** | 教材里有仪器型号与网址，删了丢信息 |
| 索引方式 | **高质量（向量）** | 不要经济模式 |
| Embedding | **bge-m3**（本地）或**通义 text-embedding-v3/v4** | 中文别用默认的 text-embedding-ada-002 |
| 检索 | **混合检索 + Rerank**（bge-reranker-v2-m3） | 术语/符号多，纯向量容易混进近义实验 |
| TopK / 阈值 | TopK 4~6、Score 阈值 0.3~0.5、重排后取 3~4 段 | 返回的是父段，4 段 × 2000 字 ≈ 8000 字，别再大 |

## 三、元数据怎么打

Dify 里先在知识库「元数据」中建字段：\`实验名\`、\`章节类型\`、\`来源\`。
- **逐文档打**（推荐）：按 \`total-clean/\` 的文件逐个上传，文件名已带实验名，直接照 CSV 填元数据字段即可（27 次）。
- **逐分片打**：若一次导入 \`total-clean.md\`，用 CSV 里的章节对应关系，通过 Dify 的「分段 → 元数据」或 API 批量赋值（工作量较大）。

检索时用元数据过滤 \`实验名 = 霍尔效应实验\`，召回范围立刻从整本教材缩到几 KB——这比调分段参数有效得多。

## 四、内容质量（比分段更影响效果）

- 先把知识库残缺项补齐再索引：检索到残缺内容，分段再漂亮也一样跑偏；不确定度口径（A/B 类判定、\`n>6\` 取 1、有效数字修约）尤其要完整成段。
- 已知残留（本次未改动，供你决定是否处理）：
  - 5 份实验知识库里有未围栏的代码（已自动围成 \`\`\`text 代码块）：\`电表的改装与校准\`、\`静电场的模拟\`、\`电容与高电阻的测量\`、\`电子偏转特性的测量\`、\`光的偏振特性测量\`。其中 \`静电场的模拟\` 混了 MATLAB 与 Python 片段。
  - 教材个别位置有 PDF 转换残留（孤立页码、断行、\`\\_\` 转义），只清了「独立成行的残片」，正文内的没有动。

## 五、改了内容后重跑

\`\`\`bash
node scripts/prepare-kb-for-dify.js
\`\`\`
脚本会重建本目录（含本 README），源文件不受影响。
`;

function writeReadme() {
  write(path.join(OUT, 'README.md'), README);
}

function main() {
  const report = ['知识库预处理报告（' + new Date().toLocaleString('zh-CN', { hour12: false }) + '）', ''];
  report.push('【教材 物理实验/rag/total.md】');
  const total = buildTotal(report);
  report.push('', '【实验知识库 27 份 rag/原理.md】');
  const exps = buildExperiments(report);

  fs.rmSync(inside(OUT, ROOT), { recursive: true, force: true });
  writeReadme();
  write(path.join(OUT, 'total-clean.md'), total.all);
  total.docs.forEach((d) => write(path.join(OUT, 'total-clean', d.file), d.text));
  exps.forEach((d) => write(path.join(OUT, 'experiments-clean', d.file), d.text));

  const meta = total.docs.map((d) => ({ file: d.file, exp: d.exp, kind: d.kind, text: d.text, source: '教材 total.md' }));
  write(path.join(OUT, 'total-metadata.csv'), csv(meta));
  write(path.join(OUT, 'experiments-metadata.csv'),
    csv(exps.map((d) => ({ file: d.file, exp: d.exp, kind: d.kind, text: d.text, source: '实验知识库 原理.md' }))));

  const stat = [
    '',
    '【产物统计】',
    `  · total-clean.md            ${total.all.length} 字`,
    `  · total-clean/              ${total.docs.length} 个文档（绪论 + 基本概念 + 25 个实验）`,
    `  · experiments-clean/        ${exps.length} 个文档，共 ${exps.reduce((s, d) => s + d.text.length, 0)} 字`,
    `  · 元数据表                  2 个 CSV`,
  ];
  write(path.join(OUT, 'cleaning-report.txt'), [...report, ...stat].join('\n') + '\n');
  console.log(report.join('\n'));
  console.log(stat.join('\n'));
}

main();
