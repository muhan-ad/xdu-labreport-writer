// 设计要点：不使用模型自报的"正确率百分比"（未校准，会误导），
//          改用「模型自标 + schema 派生校验」共同判定的三态：ok / warn / fail
// ══════════════════════════════════════════════════════════

const RECOG_IMG_MAX_SIDE = 1600;   // 长边上限，兼顾字号可读与请求体积
const RECOG_IMG_QUALITY = 0.9;
const RECOG_SCALAR_DEFAULT_TOL = 0.2;   // 与 schema 默认值的相对偏差告警阈值
const RECOG_STUDENT_FIELDS = [
  { key: 'name', label: '姓名', el: 'inputName' },
  { key: 'id', label: '学号', el: 'inputId' },
  { key: 'class', label: '班级', el: 'inputClass' },
];

let recogState = null;   // { dataUrl, name, includeStudent, student, fields }

function photoEmbedEnabled() {
  return loadSettings().embedDataPhoto !== false;
}

async function loadOcrSettingsForm() {
  const s = loadSettings();
  $('selectVisionProvider').value = s.visionProvider || 'inherit';
  $('inputVisionModel').value = s.visionModel || '';
  $('inputVisionApiUrl').value = s.visionApiUrl || '';
  $('inputVisionApiKey').value = '';
  $('chkEmbedDataPhoto').checked = s.embedDataPhoto !== false;
  const status = await window.labAPI.visionCredentialStatus();
  if (status && status.ok) {
    s.hasVisionApiKey = !!status.configured;
    saveSettings(s);
  }
  $('inputVisionApiKey').placeholder = s.hasVisionApiKey
    ? '已安全保存，留空保留；输入新密钥可替换'
    : '专用识图 Key（继承主 AI 时无需填写）';
  updateVisionFields();
}

function updateVisionFields() {
  const inherited = $('selectVisionProvider').value === 'inherit';
  $('inputVisionApiKey').disabled = inherited;
  $('inputVisionApiUrl').disabled = inherited;
  $('btnClearVisionApiKey').disabled = inherited;
}

async function saveOcrSettings(settings) {
  settings.visionProvider = $('selectVisionProvider').value;
  settings.visionModel = $('inputVisionModel').value.trim();
  settings.visionApiUrl = $('inputVisionApiUrl').value.trim();
  settings.embedDataPhoto = $('chkEmbedDataPhoto').checked;
  if (settings.visionProvider === 'custom' && !/^https:\/\//i.test(settings.visionApiUrl)) {
    showToast('error', '识图地址无效', '自定义识图服务必须使用 HTTPS');
    return false;
  }
  const key = $('inputVisionApiKey').value.trim();
  if (key) {
    const stored = await window.labAPI.saveVisionCredential({
      provider: settings.visionProvider,
      apiUrl: settings.visionApiUrl,
      key,
    });
    if (!stored.ok) {
      showToast('error', '识图密钥未保存', stored.error, 6000);
      return false;
    }
    settings.hasVisionApiKey = !!stored.configured;
  }
  return true;
}

window.loadOcrSettingsForm = loadOcrSettingsForm;
window.saveOcrSettings = saveOcrSettings;

// ── 打开识别弹窗 ──
function openRecognizeModal() {
  if (!currentSchema) {
    showToast('warning', '无法识别', '该实验尚未迁移，暂不支持表单录入');
    return;
  }
  recogState = null;
  const pane = $('recogImagePane');
  if (pane) pane.classList.remove('zoomed');
  $('recogPick').style.display = '';
  $('recogLoading').style.display = 'none';
  $('recogResult').style.display = 'none';
  $('btnApplyRecognize').disabled = true;
  $('recogImg').removeAttribute('src');
  $('recogFields').innerHTML = '';
  $('recogSummary').innerHTML = '';
  $('recogNote').textContent = '';
  $('recogNote').className = 'recog-note';
  // 学生信息识别默认关闭，且记忆上次选择
  const s = loadSettings();
  $('recogStudent').checked = !!s.recogStudent;
  // 「只填空」默认关闭：表单里通常已预填了示例数据，默认开启会把整张表锁死
  $('recogOnlyEmpty').checked = s.recogOnlyEmpty === true;
  openModal('recognizeModal');
}

// ── 图片压缩（长边限制 + 转 JPEG），压缩后反而更大就保留原图 ──
function compressImage(dataUrl, maxSide = RECOG_IMG_MAX_SIDE, quality = RECOG_IMG_QUALITY) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve(dataUrl);
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';           // 透明 PNG 垫白底，避免转 JPEG 后变黑
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        const out = cv.toDataURL('image/jpeg', quality);
        resolve(dataUrl.startsWith('data:image/bmp;') || out.length < dataUrl.length ? out : dataUrl);
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── 色调映射增强：白平衡归一化 + 对比度拉伸，去阴影/偏色 ──
// 把纸面校准到纯白（p85 → 255），暗部保持不变，保留颜色信息。
// 2026-09-15 替换了原来的全局 Otsu 二值化（实测 Otsu 在手机照片上会把桌面当内容一起变黑，5/8）。
function toScanEffect(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve(dataUrl);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const total = w * h;

        // 0. 红章检测：红墨在 R 通道里接近纸的亮度，会"消失"，露出被压住的数字
        {
          let redPixels = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 60 && d[i] - Math.max(d[i + 1], d[i + 2]) > 14) redPixels++;
          }
          if (redPixels / total > 0.01) {
            for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
          }
        }

        // 1. 灰度直方图（用于找白点和黑点的分位）
        const hist = new Array(256).fill(0);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          hist[Math.round(Math.min(255, Math.max(0, g)))]++;
        }

        // 2. 白点 = 从亮往暗找到累计 85% 处的灰度
        let cum = 0, wp = 255;
        for (let t = 255; t >= 0; t--) {
          cum += hist[t];
          if (cum >= total * 0.85) { wp = t; break; }
        }
        // 黑点 = 从暗往亮找到累计 2% 处的灰度
        cum = 0; let bp = 0;
        for (let t = 0; t <= 255; t++) {
          cum += hist[t];
          if (cum >= total * 0.02) { bp = t; break; }
        }
        const range = wp - bp;
        if (range < 10) return resolve(dataUrl);  // 前后只有 10 级，没必要

        // 3. 三通道独立线性拉伸（保留色彩，红章不会消失）
        const scale = 255.0 / range;
        for (let i = 0; i < d.length; i += 4) {
          d[i]   = Math.min(255, Math.max(0, Math.round((d[i]   - bp) * scale)));
          d[i+1] = Math.min(255, Math.max(0, Math.round((d[i+1] - bp) * scale)));
          d[i+2] = Math.min(255, Math.max(0, Math.round((d[i+2] - bp) * scale)));
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── 构造识别提示词（字段清单完全由 schema 生成，26 个实验通用）──
function buildRecogPrompt(schema, includeStudent) {
  const lines = [];
  let n = 0;
  for (const group of (schema.groups || [])) {
    if (group.name) lines.push(`【${group.name}】`);
    for (const fld of (group.fields || [])) {
      n++;
      const label = fld.label || fld.key;
      const unit = fld.unit ? ` 单位=${fld.unit}` : '';
      let shape = '';
      if (fld.type === 'array') {
        shape = ` 类型=数值数组 长度=${fld.length || '见表格行数'}`;
      } else if (fld.type === 'matrix') {
        const cols = (fld.colLabels || []).length || fld.cols || 0;
        // 有 rowLabels = 每一行身份固定（第1次/第2次…），行数必须照搬；
        // 没有 rowLabels = 这只是个定长容器，rows 是上限，照照片实际行数输出。
        const rows = fld.rows || '?';
        shape = ` 类型=数值矩阵 ${fld.rowLabels ? `尺寸=${rows}行×${cols}列` : `最多 ${rows} 行 × ${cols} 列`}`
          + (fld.colLabels ? ` 列名=${JSON.stringify(fld.colLabels)}` : '')
          + (fld.rowLabels ? ` 行名=${JSON.stringify(fld.rowLabels)}` : '');
      } else if (fld.type === 'text') {
        shape = ' 类型=文本';
      } else if (fld.type === 'science') {
        shape = ' 类型=数值（科学计数法，输出小数形式的数字即可）';
      } else {
        shape = ' 类型=数值';
      }
      lines.push(`${n}. key="${fld.key}"  标签="${label}"${shape}${unit}`);
    }
  }

  // 学生信息默认不识别：输出格式里连字段名都不出现，避免模型顺手把姓名学号读进结果
  const studentBlock = includeStudent
    ? `

【额外任务】同时读出表格顶部的学生信息，一并放进同一个 JSON：
  "student": {"name": <字符串或 null>, "id": <字符串或 null>, "class": <字符串或 null>}`
    : `

【重要】表格顶部或底部的姓名、学号、班级、指导教师等个人信息一律不要读取、不要输出。只处理上面的数据字段。`;

  const outShape = includeStudent
    ? `{"fields":{"<key>":{"value":<值>,"confidence":"high","note":"可选说明"}, ...},"student":{...}}`
    : `{"fields":{"<key>":{"value":<值>,"confidence":"high","note":"可选说明"}, ...}}`;

  return `你是一个实验数据表识别助手。请从这张纸质实验数据表的照片中，读出下面列出的每一个字段的值。

【字段清单】
${lines.join('\n')}

【取值规则】
1. 忠实抄写：表格里写 1.05 就输出 1.05，不要补成 1.050；不要替我做单位换算、四舍五入或修约。
2. 数值只给数字，不带单位、不带千分位。科学计数法写成普通小数或 e 记法，如 "2.7×10⁻⁹" → 2.7e-9。
3. 数组按表格中出现顺序（从左到右、或从上到下）给数组；矩阵给二维数组，列数必须与上面标注的一致。
   行数看标注：标了「尺寸=N行」的，要输出 N 行，且各行与「行名」一一对应；标了「最多 N 行」的，
   N 只是容器上限 —— 照片上实际写了几行就输出几行，不要为了凑满 N 行补空行或编造数据。
4. 看不清或表格里没有的数字，value 用 null，confidence 用 "low"。绝不要根据物理规律推算、补齐或猜测。
5. confidence 表示你对"这一格抄对了"的把握："high" / "medium" / "low"，逐个字段给出。

【输出格式】
只输出一个 JSON 对象。不要输出任何解释文字，不要用 markdown 代码块包裹。
${outShape}
其中 fields 必须包含上面列出的每一个 key。${studentBlock}`;
}

// 补全被截断的结尾：模型输出长 JSON 时偶尔会漏掉最后的闭合括号。
// 只补括号、不改内容；若在字符串中途截断，先补个引号再收尾。
function closeUnbalanced(s) {
  let curly = 0, square = 0, inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') curly++;
    else if (ch === '}') curly--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
  }
  if (curly <= 0 && square <= 0 && !inStr) return s;
  let out = s;
  if (esc) out = out.slice(0, -1);          // 末尾悬空的转义符要去掉
  if (inStr) out += '"';                    // 字符串没关，先关上
  return out + ']'.repeat(Math.max(0, square)) + '}'.repeat(Math.max(0, curly));
}

// ── 容错解析：模型偶尔会带 markdown 围栏、前后废话、尾随逗号或漏掉末尾括号 ──
function parseLooseJson(text) {
  if (!text) return null;
  const tryParse = (t) => { try { return JSON.parse(t); } catch (e) { return undefined; } };
  let s = String(text).trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  let v = tryParse(s);
  if (v !== undefined) return v;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) {
    // 连一个完整的 {} 都没有：可能是整体被截断，直接尝试补全
    v = tryParse(closeUnbalanced(s).replace(/,\s*([}\]])/g, '$1'));
    return v === undefined ? null : v;
  }
  const body = s.slice(a, b + 1);
  v = tryParse(body);
  if (v !== undefined) return v;
  v = tryParse(body.replace(/,\s*([}\]])/g, '$1'));
  if (v !== undefined) return v;
  // 最后兜底：模型漏了末尾闭合括号（真机测试遇过）
  v = tryParse(closeUnbalanced(body).replace(/,\s*([}\]])/g, '$1'));
  return v === undefined ? null : v;
}

// ── 数值宽容转换：模型可能回 "1.05 Ω"、"2.7×10^-9" 这类字符串 ──
function coerceNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  s = s.replace(/[×*xX]\s*10\s*\^?\s*([+\-−]?\d+)/g, 'e$1')   // 2.7×10^-9 → 2.7e-9
       .replace(/[−–—]/g, '-')
       .replace(/\s+/g, '');
  const m = s.match(/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}

// ── 从 schema 默认数组推导出「数据形状」规律（只判形状，不判数值）──
function deriveArrayPattern(def) {
  if (!Array.isArray(def) || def.length < 3) return null;
  const nums = def.map(Number);
  if (nums.some(x => !isFinite(x))) return null;
  const diffs = [];
  for (let i = 1; i < nums.length; i++) diffs.push(nums[i] - nums[i - 1]);
  if (diffs.every(d => d === 0)) return null;                   // 定值重复测量，不做形状校验
  const allPos = diffs.every(d => d > 0), allNeg = diffs.every(d => d < 0);
  if (!allPos && !allNeg) return null;                          // 无单调性 → 不校验
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const maxDev = Math.max(...diffs.map(d => Math.abs(d - mean)));
  if (maxDev <= Math.abs(mean) * 0.15) return { kind: 'arith', step: mean };
  return { kind: 'mono', dir: allPos ? 1 : -1 };
}

function checkArrayShape(arr, pattern) {
  if (!pattern || !Array.isArray(arr) || arr.some(x => !isFinite(x))) return null;
  if (pattern.kind === 'mono') {
    for (let i = 1; i < arr.length; i++) {
      if (Math.sign(arr[i] - arr[i - 1]) !== pattern.dir) {
        return `数值不再保持${pattern.dir > 0 ? '递增' : '递减'}（第 ${i} 项到第 ${i + 1} 项），请核对`;
      }
    }
    return null;
  }
  // arith：等差数列，容许与原步长同向并接近
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const dev = Math.abs(d - pattern.step);
    if (Math.sign(d) !== Math.sign(pattern.step) || dev > Math.max(Math.abs(pattern.step) * 0.15, 1e-12)) {
      return `数值不符合该表的等差规律（第 ${i} 项到第 ${i + 1} 项），请核对`;
    }
  }
  return null;
}

// ── 逐字段校验：结构 + schema 派生规律，产出三态 ──
function validateRecog(raw, schema) {
  const rawFields = (raw && raw.fields) || {};
  const out = [];
  for (const group of (schema.groups || [])) {
    for (const fld of (group.fields || [])) {
      const item = rawFields[fld.key];
      const conf = (item && typeof item.confidence === 'string') ? item.confidence.toLowerCase() : 'medium';
      const rawVal = item ? item.value : undefined;
      const note = (item && item.note) ? String(item.note) : '';
      let status = 'ok';
      const reasons = [];
      let value = null;

      const warn = (r) => { if (status === 'ok') status = 'warn'; reasons.push(r); };
      const fail = (r) => { status = 'fail'; reasons.push(r); };

      if (rawVal === undefined || rawVal === null || rawVal === '') {
        fail('未识别到该项');
      } else if (fld.type === 'array') {
        const expect = fld.length || 0;
        const arr = Array.isArray(rawVal) ? rawVal.map(coerceNum) : null;
        if (!arr) { fail('识别结果不是数组'); }
        else {
          // 措辞方向：差额是「模板把长度定死了」，不是照片抄错了
          if (expect && arr.length !== expect) {
            warn(`照片上是 ${arr.length} 项，模板固定 ${expect} 项`
              + (arr.length > expect ? '，多出的会被丢弃' : ''));
          }
          const miss = arr.filter(x => x === null).length;
          if (miss === arr.length) fail('整列都未识别');
          else if (miss) warn(`${miss} 项未识别`);
          value = arr;
          if (!miss && arr.length === expect) {
            const shapeMsg = checkArrayShape(arr, deriveArrayPattern(fld.default));
            if (shapeMsg) warn(shapeMsg);
          }
          if (value && value.every(x => x === null)) value = null;
        }
      } else if (fld.type === 'matrix') {
        const rows = fld.rows || 0, cols = fld.cols || 0;
        if (!Array.isArray(rawVal)) { fail('识别结果不是矩阵'); }
        else {
          const m = rawVal.map(r => (Array.isArray(r) ? r.map(coerceNum) : []));
          // 有 rowLabels = 每行身份固定（第1次/第2次…），行数必须与模板一致；
          // 没有 rowLabels = 定长容器，rows 只是上限：照片上几行就收几行，
          // 模型顺手带出的尾部全空行先丢掉，否则会被误报成「未识别」。
          if (fld.rowLabels) {
            if (m.length !== rows) warn(`照片上是 ${m.length} 行，模板的行名固定为 ${rows} 行`);
          } else {
            while (m.length && m[m.length - 1].every(x => x === null)) m.pop();
            if (rows && m.length > rows) {
              warn(`照片上是 ${m.length} 行，表格最多容纳 ${rows} 行，多出的会被丢弃`);
            }
          }
          const badRows = m.filter(r => r.length !== cols).length;
          if (badRows) warn(`${badRows} 行的列数不是 ${cols}`);
          const flat = m.flat();
          const miss = flat.filter(x => x === null).length;
          // 整块没读出东西就别留个空数组当「值」——与数组分支一致，保持 null
          if (!flat.length || miss === flat.length) {
            fail('整块都未识别');
          } else {
            if (miss) warn(`${miss} 格未识别`);
            value = m;
          }
        }
      } else if (fld.type === 'text') {
        value = String(rawVal);
      } else {
        const num = coerceNum(rawVal);
        if (num === null) { fail('识别结果不是数值'); }
        else {
          value = num;
          // scalar 与 schema 默认值比对：只在该默认值像"装置常量/参考值"时才有意义
          const d = Number(fld.default);
          if (isFinite(d) && Math.abs(d) > 1e-3) {
            const rel = Math.abs(num - d) / Math.abs(d);
            if (rel > RECOG_SCALAR_DEFAULT_TOL) {
              warn(`与教材参考值 ${d} 相差 ${(rel * 100).toFixed(0)}%，请核对`);
            }
          }
        }
      }

      // 模型自标 low：最多只能到 warn，不允许显示为"已识别"
      if (status === 'ok' && conf === 'low') {
        status = 'warn';
        reasons.push('模型对这项没有把握');
      }
      // note 是模型"我在表格哪里找到的"说明，不是风险信号——不能因为它升警，
      // 否则每个字段都会被标黄，告警就失去意义了。仅在已经告警时作为补充显示。
      if (note && status !== 'ok') reasons.push(note);

      out.push({
        key: fld.key,
        label: fld.label || fld.key,
        unit: fld.unit || '',
        type: fld.type,
        rows: fld.rows, cols: fld.cols,
        value,
        status,
        reason: reasons.join('；'),
      });
    }
  }
  return out;
}

// ── 判断表单里某个字段当前是否为空 ──
function isFieldEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  // 矩阵是二维的：递归判，否则「整块全空」会被元素本身是数组这一点判成非空
  if (Array.isArray(v)) return v.every(x => isFieldEmpty(x));
  return false;
}

// ── 渲染核对界面 ──
const RECOG_BADGE = {
  ok: '<span class="recog-badge ok">✓ 已识别</span>',
  warn: '<span class="recog-badge warn">⚠ 建议核对</span>',
  fail: '<span class="recog-badge fail">✗ 未识别</span>',
};

function fmtRecogValue(f) {
  if (f.value === null || f.value === undefined) return '';
  if (f.type === 'array') return f.value.map(x => x === null ? '' : x).join(', ');
  if (f.type === 'text') return String(f.value);
  return String(f.value);
}

function renderRecogResult() {
  if (!recogState || !recogState.fields) return;
  const onlyEmpty = $('recogOnlyEmpty').checked;
  const live = currentSchema ? readFormData() : {};
  const groups = [];
  const byGroup = new Map();
  for (const g of (currentSchema.groups || [])) {
    byGroup.set(g.name || '', []);
  }
  for (const f of recogState.fields) {
    let placed = false;
    for (const g of (currentSchema.groups || [])) {
      if ((g.fields || []).some(x => x.key === f.key)) {
        byGroup.get(g.name || '').push(f);
        placed = true;
        break;
      }
    }
    if (!placed) byGroup.get('') && byGroup.get('').push(f);
  }

  let okN = 0, warnN = 0, failN = 0;
  for (const f of recogState.fields) {
    if (f.status === 'ok') okN++;
    else if (f.status === 'warn') warnN++;
    else failN++;
  }

  for (const [gname, fields] of byGroup) {
    if (!fields.length) continue;
    let body = '';
    for (const f of fields) {
      const empty = isFieldEmpty(live[f.key]);
      // 「只填空」开启时，表单里已有值的字段默认不勾选、且禁止勾选
      const lock = onlyEmpty && !empty;
      const checked = !lock && f.value !== null && f.value !== undefined;
      const unit = f.unit ? `<span class="recog-row-unit">/ ${escapeHtml(f.unit)}</span>` : '';
      let input;
      if (f.type === 'matrix') {
        const m = Array.isArray(f.value) ? f.value : [];
        let tbl = '<table><thead><tr><th></th>';
        for (let c = 0; c < (f.cols || 0); c++) {
          const cl = (currentSchemaField(f.key)?.colLabels || [])[c];
          tbl += `<th>${escapeHtml(cl != null ? String(cl) : String(c + 1))}</th>`;
        }
        tbl += '</tr></thead><tbody>';
        for (let r = 0; r < (f.rows || 0); r++) {
          const rl = (currentSchemaField(f.key)?.rowLabels || [])[r];
          tbl += `<tr><th>${escapeHtml(rl != null ? String(rl) : String(r + 1))}</th>`;
          for (let c = 0; c < (f.cols || 0); c++) {
            const cell = (m[r] && m[r][c] !== undefined) ? m[r][c] : null;
            // 超出模型实际给出的行数 = 容器里没用到的格子，不算识别失败，不标红
            const cls = (cell === null && r < m.length) ? 'cell-fail' : '';
            tbl += `<td class="${cls}"><input type="number" step="any" class="recog-cell" `
              + `data-rrow="${r}" data-rcol="${c}" data-rkey="${escapeHtml(f.key)}" `
              + `value="${cell === null ? '' : escapeHtml(cell)}"></td>`;
          }
          tbl += '</tr>';
        }
        tbl += '</tbody></table>';
        input = `<div class="recog-row-wide"><div class="recog-row-matrix">${tbl}</div></div>`;
      } else if (f.type === 'array') {
        // 数组单独占一行：一行内的宽度放不下 10~42 项，用 textarea 自动折行，整列一眼看全
        input = `<div class="recog-row-wide"><textarea rows="2" class="recog-row-input recog-array-input" `
          + `data-rkey="${escapeHtml(f.key)}" title="多项用逗号或空格分隔，可直接修改">`
          + `${escapeHtml(fmtRecogValue(f))}</textarea>`
          + `<div class="recog-array-hint">${(f.value || []).filter(x => x !== null).length} 项，逗号或空格分隔</div></div>`;
      } else {
        input = `<input class="recog-row-input" data-rkey="${escapeHtml(f.key)}" `
          + `title="可直接修改" value="${escapeHtml(fmtRecogValue(f))}">`;
      }
      const reason = (f.status !== 'ok' && f.reason)
        ? `<div class="recog-row-reason">${escapeHtml(f.reason)}</div>` : '';
      // 数组/矩阵的值要占满一整行，徽标必须排在它前面，否则会被挤到下一行
      const wide = (f.type === 'array' || f.type === 'matrix');
      const badge = RECOG_BADGE[f.status];
      body += `<div class="recog-row state-${f.status}${wide ? ' has-wide' : ''}${checked ? ' checked' : ''}" data-key="${escapeHtml(f.key)}">`
        + `<input type="checkbox" class="recog-pick" ${checked ? 'checked' : ''} ${lock ? 'disabled' : ''}>`
        + `<div class="recog-row-label">${escapeHtml(f.label)} ${unit}</div>`
        + (wide ? badge + input : input + badge)
        + reason
        + `</div>`;
    }
    groups.push(`<div class="recog-group"><div class="recog-group-title">${escapeHtml(gname || '数据')}</div>${body}</div>`);
  }
  $('recogFields').innerHTML = groups.join('');

  const parts = [`已识别 <b>${okN}</b> 项`];
  if (warnN) parts.push(`<span class="recog-warn-count">${warnN} 项建议核对</span>`);
  if (failN) parts.push(`<span class="recog-fail-count">${failN} 项未识别</span>`);
  $('recogSummary').innerHTML = parts.join(' · ');

  const noteEl = $('recogNote');
  const allLocked = onlyEmpty && $('recogFields').querySelectorAll('.recog-pick:not(:disabled)').length === 0;
  if (allLocked) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = '这张表的字段在表单里都已有值，且「只填空字段」开着，所以没有可填的项。若要覆盖，请关掉左下角的「只填空字段」。';
  } else if (failN) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = `有 ${failN} 项没能从照片里读出来，已在下方标红。请对照左侧原图手动补齐，或换一张更清晰的照片重试。`;
  } else if (warnN) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = `有 ${warnN} 项建议核对（标黄）。这些是模型自己没把握、或与教材参考值/表格规律对不上的项，请重点看一遍。`;
  } else {
    noteEl.className = 'recog-note';
    noteEl.textContent = '所有字段都已读出，格式与规律检查没发现问题。';
  }

  // 勾选框联动：勾选态高亮 + 底部按钮可用性
  $('recogFields').querySelectorAll('.recog-row').forEach(row => {
    const cb = row.querySelector('.recog-pick');
    if (!cb) return;
    cb.addEventListener('change', () => {
      row.classList.toggle('checked', cb.checked);
      updateApplyBtn();
    });
  });
  updateApplyBtn();
}

function currentSchemaField(key) {
  for (const g of (currentSchema?.groups || [])) {
    for (const f of (g.fields || [])) if (f.key === key) return f;
  }
  return null;
}

function updateApplyBtn() {
  const n = $('recogFields').querySelectorAll('.recog-pick:checked').length;
  const btn = $('btnApplyRecognize');
  btn.disabled = n === 0;
  btn.textContent = n ? `填入所选（${n}）` : '填入所选';
}

// ── 选图 → 压缩 → 识别 ──
async function startRecognition(dataUrl, name) {
  if (!currentSchema) { showToast('warning', '无法识别', '该实验尚未迁移'); return; }
  const settings = loadSettings();
  const vProvider = settings.visionProvider || 'inherit';
  if ((vProvider === 'inherit' && !settings.hasApiKey) || (vProvider !== 'inherit' && !settings.hasVisionApiKey)) {
    showToast('warning', '未配置 API Key', '请先在「设置 → AI 服务」里填写识图用的 Key', 6000);
    return;
  }

  $('recogPick').style.display = 'none';
  $('recogResult').style.display = 'none';
  $('recogLoading').style.display = '';
  $('recogLoadingText').textContent = '正在压缩图片…';
  $('btnApplyRecognize').disabled = true;

  // 识图用的这张原图顺手落盘，生成报告时嵌进「一、原始数据记录」。
  // 放在压缩之前：要的是原图（设置项选的就是原图），压缩版只喂给模型。
  // 不 await —— 落盘失败或慢都不该拖住识图；currentExp 必须判空，
  // 「换一张」路径没有 currentSchema 那种守卫。
  if (photoEmbedEnabled() && currentExp && currentExp.path) {
    window.labAPI.saveTableImage(currentExp.path, dataUrl).catch(() => {});
  }

  const includeStudent = $('recogStudent').checked;
  const compressed = await compressImage(dataUrl);
  $('recogImg').src = compressed;
  // 勾了「扫描增强」就做白平衡归一化 + 对比度拉伸（p85→255），把纸面拉到纯白
  const aiImg = $('recogScan').checked ? await toScanEffect(compressed) : compressed;
  $('recogLoadingText').textContent = '正在识别数据表…（大图可能需要 10~30 秒）';

  const prompt = buildRecogPrompt(currentSchema, includeStudent);
  const messages = [
    { role: 'system', content: '你是严谨的实验数据抄录助手。你只抄写照片中真实存在的数字，绝不推算、补齐或美化数据。你只输出 JSON。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: aiImg } },
      ],
    },
  ];

  const model = settings.visionModel
    || (vProvider === 'siliconflow' ? 'Qwen/Qwen3-VL-32B-Instruct'
      : vProvider === 'bailian' ? 'qwen3-vl-plus'
      : settings.model)
    || '';
  let result;
  try {
    result = await window.labAPI.ocrRecognize({
      visionProvider: vProvider,
      provider: settings.provider || 'deepseek',
      apiUrl: settings.apiUrl || '',
      visionApiUrl: settings.visionApiUrl || '',
      model,
      prompt,
      imageDataUrl: aiImg,
    });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  if (!result || !result.ok) {
    $('recogLoading').style.display = 'none';
    $('recogPick').style.display = '';
    showToast('error', '识别失败', (result && result.error) || '未知错误', 8000);
    return;
  }

  const parsed = parseLooseJson(result.content);
  if (!parsed || !parsed.fields) {
    $('recogLoading').style.display = 'none';
    $('recogPick').style.display = '';
    showToast('error', '模型返回无法解析', '模型这次的输出不是有效 JSON。若反复出现，可能是该模型不支持图片输入，可在设置里换用识图模型。', 8000);
    return;
  }

  recogState = {
    dataUrl: compressed,
    name: name || '',
    includeStudent,
    student: parsed.student || null,
    fields: validateRecog(parsed, currentSchema),
  };

  $('recogLoading').style.display = 'none';
  $('recogResult').style.display = '';
  renderRecogResult();

  // 模型没返回 student 字段时，说明它忽略了这半边任务
  if (includeStudent && !parsed.student) {
    showToast('warning', '学生信息未读出', '模型没有返回学生信息，可在填完数据后手动补充', 6000);
  }
}

// ── 从核对界面读回（用户可能已手工改过识别结果）──
function collectRecogValues() {
  const out = {};
  if (!recogState) return out;
  for (const f of recogState.fields) {
    const row = $('recogFields').querySelector(`.recog-row[data-key="${f.key}"]`);
    if (!row) continue;
    const cb = row.querySelector('.recog-pick');
    if (!cb || !cb.checked) continue;
    if (f.type === 'matrix') {
      const m = [];
      for (let r = 0; r < (f.rows || 0); r++) {
        const rowArr = [];
        for (let c = 0; c < (f.cols || 0); c++) {
          const inp = row.querySelector(`input[data-rrow="${r}"][data-rcol="${c}"]`);
          const n = inp && inp.value.trim() !== '' ? parseFloat(inp.value) : NaN;
          rowArr.push(isFinite(n) ? n : null);
        }
        m.push(rowArr);
      }
      out[f.key] = m;
    } else if (f.type === 'array') {
      const inp = row.querySelector('.recog-row-input');
      const arr = (inp ? inp.value : '').split(/[,，\s]+/).map(s => s.trim()).filter(s => s !== '')
        .map(s => { const n = coerceNum(s); return n === null ? null : n; });
      out[f.key] = arr.length ? arr : null;
    } else if (f.type === 'text') {
      const inp = row.querySelector('.recog-row-input');
      out[f.key] = inp && inp.value.trim() !== '' ? inp.value.trim() : null;
    } else {
      const inp = row.querySelector('.recog-row-input');
      const n = inp && inp.value.trim() !== '' ? coerceNum(inp.value) : null;
      out[f.key] = n;
    }
  }
  return out;
}

// ── 填入表单 ──
function applyRecognition() {
  if (!recogState || !currentSchema) return;
  const onlyEmpty = $('recogOnlyEmpty').checked;
  const picked = collectRecogValues();
  const live = readFormData();          // 先读回表单，保证用户之前的手工编辑不丢
  let filled = 0, skipped = 0, blank = 0;

  for (const [key, value] of Object.entries(picked)) {
    if (value === null || value === undefined) { blank++; continue; }
    if (Array.isArray(value) && value.every(x => x === null)) { blank++; continue; }
    if (onlyEmpty && !isFieldEmpty(live[key])) { skipped++; continue; }
    live[key] = value;
    filled++;
  }

  // 学生信息
  let stuFilled = 0, stuSkipped = 0;
  if (recogState.includeStudent && recogState.student) {
    const info = loadStudentInfo();
    for (const sf of RECOG_STUDENT_FIELDS) {
      const val = recogState.student[sf.key];
      const el = $(sf.el);
      if (!el || !val || !String(val).trim()) continue;
      if (onlyEmpty && el.value.trim()) { stuSkipped++; continue; }
      el.value = String(val).trim();
      info[sf.key] = String(val).trim();
      stuFilled++;
    }
    if (stuFilled) {
      info.date = info.date || new Date().toLocaleDateString('zh-CN');
      saveStudentInfo(info);
      updateStudentDisplay();
    }
  }

  if (!filled && !stuFilled) {
    showToast('warning', '没有可填入的内容', blank ? '勾选的项里没有识别出有效数值' : '请至少勾选一项', 5000);
    return;
  }

  currentData = live;
  renderForm();
  isDataModified = true;
  notifyDataModified();
  $('btnSaveData').disabled = false;
  refreshFormCheck();
  closeModal('recognizeModal');

  const bits = [`已填入 ${filled} 个字段`];
  if (skipped) bits.push(`跳过 ${skipped} 个已有值`);
  if (blank) bits.push(`${blank} 个无有效值`);
  if (stuFilled) bits.push(`学生信息 ${stuFilled} 项`);
  if (stuSkipped) bits.push(`学生信息跳过 ${stuSkipped} 项`);
  showToast('success', '已填入表单', bits.join(' · ') + '，核对后点「保存修改」', 6000);
}

// ── 事件绑定 ──
function bindRecognizeEvents() {
  const btn = $('btnRecognize');
  if (btn) btn.onclick = openRecognizeModal;
  if (!$('recognizeModal')) return;

  $('btnCloseRecognize').onclick = () => closeModal('recognizeModal');
  $('btnCancelRecognize').onclick = () => closeModal('recognizeModal');
  $('btnApplyRecognize').onclick = applyRecognition;

  // 原图点击放大/还原（核对时手写数字要看得清）
  const pane = $('recogImagePane');
  const toggleZoom = () => pane.classList.toggle('zoomed');
  pane.onclick = toggleZoom;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane.classList.contains('zoomed')) {
      pane.classList.remove('zoomed');
      e.stopPropagation();
    }
  });

  const drop = $('recogDrop');
  const choose = async () => {
    const r = await window.labAPI.pickTableImage();
    if (!r || !r.ok) { if (r && r.error) showToast('error', '读取图片失败', r.error, 6000); return; }
    if (r.canceled) return;
    await startRecognition(r.dataUrl, r.name);
  };
  drop.onclick = choose;

  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover');
  }));
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !/^image\//.test(file.type)) { showToast('warning', '不是图片', '请拖入 jpg / png / webp 图片', 5000); return; }
    if (file.size > 20 * 1024 * 1024) { showToast('warning', '图片过大', '请压缩到 20MB 以内', 5000); return; }
    const fr = new FileReader();
    fr.onload = () => startRecognition(String(fr.result), file.name);
    fr.readAsDataURL(file);
  });

  // Ctrl+V 粘贴截图（仅在弹窗打开且处于选图阶段时接管）
  document.addEventListener('paste', (e) => {
    if (!$('recognizeModal').classList.contains('show')) return;
    if ($('recogPick').style.display === 'none') return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const fr = new FileReader();
        fr.onload = () => startRecognition(String(fr.result), '剪贴板图片');
        fr.readAsDataURL(file);
        return;
      }
    }
  });

  // 记住开关偏好
  $('recogStudent').onchange = () => {
    const s = loadSettings(); s.recogStudent = $('recogStudent').checked; saveSettings(s);
  };
  $('recogOnlyEmpty').onchange = () => {
    const s = loadSettings(); s.recogOnlyEmpty = $('recogOnlyEmpty').checked; saveSettings(s);
    if (recogState && recogState.fields) renderRecogResult();
  };

  // 核对界面里直接改识别值后，去掉该项的告警横幅提示（值已由用户确认）
  $('recogFields').addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('.recog-row');
    if (row) row.classList.add('edited');
  });

  $('selectVisionProvider').onchange = updateVisionFields;
  $('btnClearVisionApiKey').onclick = async () => {
    const s = loadSettings();
    const r = await window.labAPI.saveVisionCredential({
      provider: s.visionProvider || 'custom', apiUrl: s.visionApiUrl || '', key: '',
    });
    if (!r.ok) return showToast('error', '清除失败', r.error);
    s.hasVisionApiKey = false; saveSettings(s);
    $('inputVisionApiKey').value = '';
    $('inputVisionApiKey').placeholder = '专用识图 Key';
    showToast('success', '已清除', '识图专用密钥已删除');
  };
}

bindRecognizeEvents();
