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
  $('inputVisionApiUrl').dataset.ownValue = s.visionApiUrl || '';
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
  $('btnClearVisionApiKey').disabled = inherited;
  const urlInput = $('inputVisionApiUrl');
  const hint = $('visionApiUrlHint');
  urlInput.disabled = inherited;
  if (inherited) {
    // 继承：地址栏灰显并自动填入"上方 AI 服务"的真实地址（由主进程解析，含服务商预设）
    urlInput.dataset.ownValue = urlInput.dataset.ownValue || loadSettings().visionApiUrl || '';
    if (hint) hint.textContent = '继承上方 AI 服务：地址自动填充，不可修改。';
    refreshVisionInheritedUrl();
  } else {
    // 切回独立服务：恢复用户自己填过的地址（不要把继承来的地址留在框里）
    urlInput.value = urlInput.dataset.ownValue || loadSettings().visionApiUrl || '';
    urlInput.dataset.ownValue = urlInput.value;   // 保持备份与当前值一致
    if (hint) hint.textContent = '专用密钥使用系统安全存储，并与服务地址绑定。';
  }
}

// 继承态下把主 API 的真实地址同步到识图地址栏（切提供商 / 改主地址时调用）
async function refreshVisionInheritedUrl() {
  const sel = $('selectVisionProvider');
  if (!sel || sel.value !== 'inherit') return;
  const settings = loadSettings();
  try {
    const r = await window.labAPI.resolveEndpoints({
      provider: settings.provider || 'deepseek',
      apiUrl: $('inputApiUrl') ? $('inputApiUrl').value.trim() : (settings.apiUrl || ''),
    });
    $('inputVisionApiUrl').value = (r && r.chat) || '';
  } catch (e) { /* 地址不合法时留空，保存时会给出提示 */ }
}

async function saveOcrSettings(settings) {
  settings.visionProvider = $('selectVisionProvider').value;
  settings.visionModel = $('inputVisionModel').value.trim();
  // 继承态下地址栏显示的是主 API 地址（只读），不能把它写进用户自己的识图地址，
  // 否则切回独立服务时会丢掉用户上次填的地址
  if (settings.visionProvider === 'inherit') {
    settings.visionApiUrl = $('inputVisionApiUrl').dataset.ownValue || settings.visionApiUrl || '';
  } else {
    settings.visionApiUrl = $('inputVisionApiUrl').value.trim();
  }
  settings.embedDataPhoto = $('chkEmbedDataPhoto').checked;
  if (settings.visionProvider === 'custom' && !/^https:\/\//i.test(settings.visionApiUrl)) {
    showToast('error', '识图地址无效', '自定义识图服务必须使用 HTTPS');
    return false;
  }
  const key = $('inputVisionApiKey').value.trim();
  if (key) {
    const stored = await window.labAPI.saveVisionCredential({
      provider: settings.visionProvider,
      visionApiUrl: settings.visionApiUrl,   // 与识图请求同名字段：保证密钥绑定的地址一致
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
  cancelRecognition();          // 上一次残留的识别请求先作废
  recogState = null;
  const zoomBox = $('recogZoom');
  if (zoomBox) zoomBox.style.display = 'none';   // 关掉可能残留的放大灯箱
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
  // 「只填空」选项已移到人工核对界面（#recogOnlyEmptyReview），此处不再重置
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

// ── 构造识别提示词（字段清单完全由 schema 生成，所有实验通用）──
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
      const hint = fld.ocrHint ? ` 识图提示=${fld.ocrHint}` : '';
      lines.push(`${n}. key="${fld.key}"  标签="${label}"${shape}${unit}${hint}`);
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
// 数值解析实现在 src/shared/ocr-number.js（整串严格匹配，渲染层与 Node 单测共用）
const coerceNum = (window.ocrNumber || {}).coerceNum || (() => null);

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
          let m = rawVal.map(r => (Array.isArray(r) ? r.map(coerceNum) : []));
          if (fld.ocrTranspose && m.length === cols && m.every(r => r.length === rows)) {
            m = Array.from({ length: rows }, (_, hole) => m.map(repeat => repeat[hole]));
            warn('已把照片的测量次数×孔位表格转为每孔一行，请核对');
          }
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
        else if ((fld.minimum != null && num < fld.minimum)
          || (fld.maximum != null && num > fld.maximum)) {
          fail(`识别值超出${fld.label || fld.key}允许范围，请核对`);
        }
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

// ── 渲染核对页（识别结果页即核对页：数据格用主表单同款结构）──
// 「只填空字段」偏好（控件在结果页底部 #recogOnlyEmptyReview，设置里持久化）
function recogOnlyEmptyPref() {
  return loadSettings().recogOnlyEmpty === true;
}

function renderRecogResult() {
  if (!recogState || !recogState.fields) return;
  const onlyEmpty = recogOnlyEmptyPref();
  const onlyEmptyEl = $('recogOnlyEmptyReview');
  if (onlyEmptyEl) onlyEmptyEl.checked = onlyEmpty;   // 沿用上次选择（默认关闭）
  // 识别值摊平为 {key: value}，交给主表单同款数据格渲染（renderField 的 dataOverride）
  const data = {};
  for (const f of recogState.fields) data[f.key] = f.value;

  let okN = 0, warnN = 0, failN = 0;
  for (const f of recogState.fields) {
    if (f.status === 'ok') okN++;
    else if (f.status === 'warn') warnN++;
    else failN++;
  }

  let html = '';
  for (const g of (currentSchema.groups || [])) {
    const fields = g.fields || [];
    if (!fields.length) continue;
    let body = '';
    for (const fld of fields) {
      const f = recogState.fields.find(x => x.key === fld.key);
      const status = f ? f.status : 'fail';
      const reason = (f && status !== 'ok' && f.reason)
        ? `<div class="recog-field-reason">${escapeHtml(f.reason)}</div>` : '';
      // 默认全部勾选（无需逐项选择）；取消勾选即不导入该字段
      body += `<div class="review-field" data-status="${status}" data-key="${escapeHtml(fld.key)}">`
        + `<label class="review-pick" title="勾选后导入该字段"><input type="checkbox" class="recog-pick" data-key="${escapeHtml(fld.key)}" checked></label>`
        + renderField(fld, data)
        + reason
        + `</div>`;
    }
    html += `<div class="recog-group"><div class="recog-group-title">${escapeHtml(g.name || '数据')}</div>${body}</div>`;
  }
  $('recogFields').innerHTML = html;

  const parts = [`已识别 <b>${okN}</b> 项`];
  if (warnN) parts.push(`<span class="recog-warn-count">${warnN} 项建议核对</span>`);
  if (failN) parts.push(`<span class="recog-fail-count">${failN} 项未识别</span>`);
  $('recogSummary').innerHTML = parts.join(' · ');

  const noteEl = $('recogNote');
  const nonEmpty = recogState.fields.filter(f => !isFieldEmpty(data[f.key])).length;
  if (failN) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = `有 ${failN} 项没能从照片里读出来，已标红。请对照左侧原图手动补齐，或换一张更清晰的照片重试。`;
  } else if (warnN) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = `有 ${warnN} 项建议核对（标黄）。这些是模型自己没把握、或与教材参考值/表格规律对不上的项，请重点看一遍。`;
  } else if (onlyEmpty && nonEmpty === 0) {
    noteEl.className = 'recog-note warn';
    noteEl.textContent = '识别结果里没有有效数值，且「只填空字段」开着。可关掉底部「只填空字段」或换一张更清晰的照片重试。';
  } else {
    noteEl.className = 'recog-note';
    noteEl.textContent = '所有字段都已读出，格式与规律检查没发现问题。';
  }

  // 勾选联动：取消勾选 → 整块变暗；底部按钮显示已选数
  $('recogFields').querySelectorAll('.review-field').forEach(row => {
    const cb = row.querySelector('.recog-pick');
    if (!cb) return;
    cb.addEventListener('change', () => {
      row.classList.toggle('unpicked', !cb.checked);
      updateApplyBtn();
    });
  });
  updateApplyBtn();
}

function updateApplyBtn() {
  // 结果页即核对页：默认全选，点「导入数据」直接写入表单并存训练样本
  const btn = $('btnApplyRecognize');
  const total = (recogState && Array.isArray(recogState.fields)) ? recogState.fields.length : 0;
  const picked = $('recogFields') ? $('recogFields').querySelectorAll('.recog-pick:checked').length : 0;
  btn.disabled = total === 0 || picked === 0;
  btn.textContent = (picked > 0 && picked < total) ? `导入数据（已选 ${picked}/${total}）` : '导入数据';
}

// 识别会话：绑定「实验 ID + 请求 ID」。关闭弹窗/换图/换实验后，晚到的结果一律丢弃，
// 否则会把上一个实验（或上一次识图）的数据写进当前状态（历史缺陷 R13）。
let recogSession = null;
let recogSeq = 0;         // requestId 的自增后缀（无 crypto.randomUUID 时使用）

function cancelRecognition(reason) {
  if (!recogSession || !recogSession.requestId) return;
  recogSession.cancelled = true;
  try { window.labAPI.ocrCancel(recogSession.requestId); } catch (e) { /* 忽略 */ }
  recogSession = null;
  if (reason) {
    $('recogLoading').style.display = 'none';
    $('recogPick').style.display = '';
  }
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

  // 原图先留在内存里，等用户确认识别结果后再落盘（历史缺陷 R13）：
  // 旧实现是在识别前就异步保存、且失败静默，取消或识别失败也会把原图替换掉。
  const originalDataUrl = dataUrl;
  const requestId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `recog-${Date.now()}-${(recogSeq += 1)}`;
  const expId = (currentExp && currentExp.id) || '';
  recogSession = { requestId, expId, cancelled: false };

  const includeStudent = $('recogStudent').checked;
  const compressed = await compressImage(dataUrl);
  // 核对用原图（打码只在数据共享时做）：手写数字看得更清；失败时回退压缩图
  $('recogImg').src = originalDataUrl || compressed;
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
      requestId,
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

  // 会话校验：这次结果是否仍属于「同一个实验 + 同一次识图」
  if (!recogSession || recogSession.requestId !== requestId || recogSession.cancelled) return;
  if (((currentExp && currentExp.id) || '') !== expId) {
    recogSession = null;
    $('recogLoading').style.display = 'none';
    $('recogPick').style.display = '';
    showToast('warning', '已忽略过期的识别结果', '识别期间切换了实验，本次结果未填入', 6000);
    return;
  }
  if (!result || !result.ok) {
    recogSession = null;
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
    aiRaw: parsed,                // 模型原始输出（含 confidence/note）：识图训练样本的「AI 识别数据」
    dataUrl: compressed,          // 喂给模型的那张（核对界面显示用）
    originalDataUrl,              // 原图：确认后再落盘成「原始数据照片」
    expId,
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

// ── 核对页取值与导入 ──
// 核对页就是识别结果页（#recogFields）；这里 scoped 读回全部值，不碰主表单 DOM。
// 未勾选的字段视为「不导入」（值返回 null）。
function collectReviewValues() {
  const root = $('recogFields');
  const out = {};
  if (!root) return out;
  const num = (el) => (el && el.value.trim() !== '' ? coerceNum(el.value) : null);
  for (const g of (currentSchema.groups || [])) {
    for (const fld of (g.fields || [])) {
      const wrap = [...root.querySelectorAll('.review-field')].find(el => el.dataset.key === fld.key);
      const cb = wrap ? wrap.querySelector('.recog-pick') : null;
      if (!wrap || (cb && !cb.checked)) { out[fld.key] = null; continue; }
      // 只收数据格（.field-input）：同一块里还有带 data-key 的勾选框（.recog-pick，value 恒为 'on'），
      // 不过滤就会被下面的 els[0] 当成字段值读走（number 读成 null 导不进去、text 读成 "on"）
      const els = [...wrap.querySelectorAll('.field-input[data-key]')].filter(el => el.dataset.key === fld.key);
      if (!els.length) { out[fld.key] = null; continue; }
      if (fld.type === 'science') {
        const m = num(els.find(el => el.classList.contains('science-mantissa')));
        const e = els.find(el => el.classList.contains('science-exp'));
        const ev = e && e.value.trim() !== '' ? Number(e.value) : null;
        out[fld.key] = (m === null || ev === null) ? null : m * Math.pow(10, ev);
      } else if (fld.type === 'array') {
        const arr = els.filter(el => el.classList.contains('array-input'))
          .sort((a, b) => Number(a.dataset.idx) - Number(b.dataset.idx))
          .map(el => num(el));
        out[fld.key] = arr.some(v => v !== null) ? arr : null;
      } else if (fld.type === 'matrix') {
        const m = [];
        let any = false;
        for (let r = 0; r < (fld.rows || 0); r++) {
          const rowArr = [];
          for (let c = 0; c < (fld.cols || 0); c++) {
            const el = els.find(x => x.classList.contains('matrix-cell')
              && Number(x.dataset.row) === r && Number(x.dataset.col) === c);
            const v = num(el);
            if (v !== null) any = true;
            rowArr.push(v);
          }
          m.push(rowArr);
        }
        out[fld.key] = any ? m : null;
      } else if (fld.type === 'text') {
        const el = els[0];
        out[fld.key] = el && el.value.trim() !== '' ? el.value.trim() : null;
      } else {
        out[fld.key] = num(els[0]);
      }
    }
  }
  return out;
}

// 关闭识别弹窗的统一出口：取消进行中的识别 + 清空核对页 DOM + 关弹窗。
// 核对页输入与主表单共用 data-key，残留下来会串进主表单取值（数组长度翻倍），必须清掉。
// 三条关闭路径（右上角 ×、底部取消、导入完成后）与点击遮罩都走这里。
function closeRecognizeModal() {
  cancelRecognition();
  $('recogFields').innerHTML = '';
  closeModal('recognizeModal');
}

// 核对完成 → 导入表单 + 保存识图训练样本三件套（原图 / AI 识别 / 人工校对）
async function applyReview() {
  if (!recogState || !currentSchema || !currentExp) return;
  const reviewData = collectReviewValues();
  const onlyEmpty = $('recogOnlyEmptyReview').checked;
  const live = readFormData();          // 先读回表单，保证用户之前的手工编辑不丢
  let filled = 0, skipped = 0;

  for (const [key, value] of Object.entries(reviewData)) {
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.every(x => x === null));
    if (empty) continue;
    if (onlyEmpty && !isFieldEmpty(live[key])) { skipped++; continue; }
    live[key] = value;
    filled++;
  }

  // 学生信息（勾选识别时才会有）
  let stuFilled = 0;
  if (recogState.includeStudent && recogState.student) {
    const info = loadStudentInfo();
    for (const sf of RECOG_STUDENT_FIELDS) {
      const val = recogState.student[sf.key];
      const el = $(sf.el);
      if (!el || !val || !String(val).trim()) continue;
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
    showToast('warning', '没有可导入的内容', '核对页里没有有效数值（或都被取消了勾选）', 5000);
    return;
  }

  currentData = live;
  renderForm();
  isDataModified = true;
  notifyDataModified();
  $('btnSaveData').disabled = false;
  refreshFormCheck();

  // 原图落盘为「原始数据照片」（与既有语义一致）
  if (photoEmbedEnabled() && recogState.originalDataUrl && recogState.expId
      && currentExp && currentExp.id === recogState.expId && currentExp.path) {
    try {
      const saved = await window.labAPI.saveTableImage(currentExp.path, recogState.originalDataUrl);
      if (saved && saved.ok === false) throw Error(saved.error || '保存失败');
    } catch (e) {
      showToast('warning', '照片未保存', '识别结果已填入，但原始数据照片保存失败（' + ((e && e.message) || e) + '）', 9000);
    }
  }
  recogSession = null;

  // 训练样本三件套：原图 / AI 识别（模型原始输出）/ 人工校对（核对界面的最终值）
  const proofread = { fields: {} };
  for (const [key, value] of Object.entries(reviewData)) {
    if (value === null || value === undefined
      || (Array.isArray(value) && value.every(x => x === null))) continue;
    proofread.fields[key] = { value };
  }
  if (recogState.includeStudent && recogState.student) proofread.student = recogState.student;
  let sampleSaved = false, sampleErr = '';
  try {
    const sr = await window.labAPI.saveVisionSample({
      expId: recogState.expId,
      ts: cvTs(),
      photoDataUrl: recogState.originalDataUrl || recogState.dataUrl || '',
      aiData: recogState.aiRaw || { fields: {} },
      proofreadData: proofread,
    });
    sampleSaved = !!(sr && sr.ok);
    if (!sampleSaved) sampleErr = (sr && sr.error) || '未知错误';
  } catch (e) { sampleErr = (e && e.message) || String(e); }

  const bits = [`已导入 ${filled} 个字段`];
  if (skipped) bits.push(`跳过 ${skipped} 个已有值`);
  if (stuFilled) bits.push(`学生信息 ${stuFilled} 项`);
  closeRecognizeModal();
  if (sampleSaved) {
    showToast('success', bits.join(' · '), '识图样本已保存（原图 + AI 识别 + 人工校对），可在「数据贡献 → 识图数据」中贡献', 10000);
  } else {
    showToast('warning', bits.join(' · '), '识图样本保存失败（' + sampleErr + '），不影响本次导入', 9000);
  }
  recogState = null;
  recogSession = null;
}

// ── 事件绑定 ──
function bindRecognizeEvents() {
  const btn = $('btnRecognize');
  if (btn) btn.onclick = openRecognizeModal;
  if (!$('recognizeModal')) return;

  // 关闭弹窗即取消进行中的识别请求：既省一次 API 调用，也避免晚到结果污染状态
  const closeAndCancel = () => closeRecognizeModal();
  $('btnCloseRecognize').onclick = closeAndCancel;
  $('btnCancelRecognize').onclick = closeAndCancel;
  $('btnApplyRecognize').onclick = applyReview;   // 结果页即核对页：直接导入

  // 原图点击放大（核对时手写数字要看得清）：独立顶层灯箱（#recogZoom，body 层），
  // 图片按视口最大化并居中；点击任意处或按 Esc 关闭
  const pane = $('recogImagePane');
  const zoomBox = $('recogZoom');
  const zoomImg = $('recogZoomImg');
  const setZoom = (on) => {
    if (!zoomBox || !zoomImg) return;
    if (on) zoomImg.src = $('recogImg').src || '';
    zoomBox.style.display = on ? '' : 'none';
  };
  pane.onclick = () => setZoom(true);
  if (zoomBox) {
    zoomBox.onclick = () => setZoom(false);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && zoomBox.style.display !== 'none') {
        setZoom(false);
        e.stopPropagation();
      }
    });
  }

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
  const reviewEmpty = $('recogOnlyEmptyReview');
  if (reviewEmpty) reviewEmpty.onchange = () => {
    const s = loadSettings(); s.recogOnlyEmpty = reviewEmpty.checked; saveSettings(s);
  };

  // 核对页里直接改过值的字段加高亮（表示已被人工确认/修改）
  $('recogFields').addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('.review-field');
    if (row) row.classList.add('edited');
  });

  $('selectVisionProvider').onchange = updateVisionFields;
  // 面板收起前尚未保存的专用地址也要在切换继承/独立服务时保留。
  $('inputVisionApiUrl').addEventListener('input', () => {
    if ($('selectVisionProvider').value !== 'inherit') {
      $('inputVisionApiUrl').dataset.ownValue = $('inputVisionApiUrl').value;
    }
  });
  $('btnClearVisionApiKey').onclick = async () => {
    const s = loadSettings();
    const r = await window.labAPI.saveVisionCredential({
      provider: s.visionProvider || 'custom', visionApiUrl: s.visionApiUrl || '', key: '',
    });
    if (!r.ok) return showToast('error', '清除失败', r.error);
    s.hasVisionApiKey = false; saveSettings(s);
    $('inputVisionApiKey').value = '';
    $('inputVisionApiKey').placeholder = '专用识图 Key';
    showToast('success', '已清除', '识图专用密钥已删除');
  };
}

bindRecognizeEvents();
