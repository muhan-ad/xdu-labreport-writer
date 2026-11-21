import {toCanvas} from 'html-to-image';
import {renderFormulaSvg} from './formula-svg.js';

// The preview frame has an opaque origin and no network access.
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MARGIN = 76;
const CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN;
const MAX_PAGES = 50;
const SCALE = 1.6;

function pageBreaks(source) {
  const top = source.getBoundingClientRect().top;
  const height = source.offsetHeight;
  const blocks = [...source.querySelectorAll('p, tr, img, svg')];
  const ranges = blocks.map(block => {
    const rect = block.getBoundingClientRect();
    return [Math.floor(rect.top - top), Math.ceil(rect.bottom - top)];
  }).filter(([start, end]) => end > start && end - start <= CONTENT_HEIGHT)
    .sort((a, b) => b[0] - a[0]);
  const breaks = [0];
  let start = 0;
  while (start < height) {
    if (breaks.length > MAX_PAGES) throw Error('报告超过 PDF 预览页数限制');
    let end = Math.min(start + CONTENT_HEIGHT, height);
    if (end < height) {
      // Move the break before any paragraph, formula, or table row it intersects.
      for (const [a, b] of ranges) {
        if (a > start && a < end && b > end) end = a;
      }
    }
    breaks.push(end);
    start = end;
  }
  return breaks;
}

globalThis.renderReportPages = async (source, appendPage, current) => {
  renderFormulaSvg(source);
  await Promise.all([...source.querySelectorAll('img')].map(image => image.decode()));
  const breaks = pageBreaks(source);
  const pageCount = breaks.length - 1;
  if (!pageCount) throw Error('报告没有可预览的内容');
  const sheet = document.createElement('div');
  sheet.className = 'pdf-capture-sheet';
  const clip = document.createElement('div');
  clip.className = 'pdf-capture-clip';
  sheet.append(clip);
  source.before(sheet);
  clip.append(source);
  try {
    for (let index = 0; index < pageCount && current(); index++) {
      clip.style.height = `${breaks[index + 1] - breaks[index]}px`;
      source.style.top = `${-breaks[index]}px`;
      const canvas = await toCanvas(sheet, {
        width: PAGE_WIDTH, height: PAGE_HEIGHT, pixelRatio: SCALE,
        backgroundColor: '#fff', skipFonts: true,
      });
      const image = document.createElement('img');
      image.className = 'pdf-preview-page';
      image.alt = `报告第 ${index + 1} 页，共 ${pageCount} 页`;
      image.src = canvas.toDataURL('image/jpeg', 0.94);
      canvas.width = canvas.height = 0;
      await image.decode();
      if (current()) appendPage(image);
    }
  } finally {
    sheet.remove();
  }
};
