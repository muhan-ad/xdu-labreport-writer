// Development-only snapshot from desktop src/ocr.js. Never shipped in the app.
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

export {toScanEffect};
