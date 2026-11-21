import {mathjax} from 'mathjax-full/js/mathjax.js';
import {MathML} from 'mathjax-full/js/input/mathml.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const renderer = mathjax.document('', {
  InputJax: new MathML(),
  OutputJax: new SVG({fontCache: 'none'}),
});
const namespace = 'http://www.w3.org/1998/Math/MathML';

export function renderFormulaSvg(source) {
  for (const math of source.querySelectorAll('math')) {
    const display = math.getAttribute('display') === 'block';
    const styledRun = math.querySelector('ms[style*="font-size"]');
    const fontSize = parseFloat(getComputedStyle(styledRun ?? math).fontSize) || 16;
    // MathML token elements cannot contain other MathML elements.
    for (const token of math.querySelectorAll('ms, mn, mi, mo')) {
      if (token.querySelector('mrow, msub, msup, msubsup, mfrac, msqrt')) {
        const row = document.createElementNS(namespace, 'mrow');
        row.append(...token.childNodes);
        token.replaceWith(row);
      } else if (token.localName === 'ms') {
        const value = token.textContent;
        const tag = /^\p{L}$/u.test(value) ? 'mi' : /^\d+(?:[.,]\d+)?$/.test(value) ? 'mn' :
          /^[=+−–×⋅≈±<>≤≥∝]$/.test(value) ? 'mo' : 'mtext';
        const element = document.createElementNS(namespace, tag);
        element.textContent = value;
        if (tag === 'mtext' && value.trim() === '') {
          const space = document.createElementNS(namespace, 'mspace');
          space.setAttribute('width', '0.25em');
          token.replaceWith(space);
          continue;
        }
        token.replaceWith(element);
      }
    }
    const result = renderer.convert(new XMLSerializer().serializeToString(math), {
      display, em: fontSize, ex: fontSize / 2,
    });
    const svg = new DOMParser().parseFromString(
      adaptor.outerHTML(adaptor.firstChild(result)), 'image/svg+xml',
    ).documentElement;
    if (svg.localName !== 'svg' || !svg.childElementCount ||
        svg.querySelector('[data-mml-node="merror"]') || adaptor.getAttribute(result, 'data-mjx-error')) {
      throw Error('无法排版报告公式');
    }
    const body = document.importNode(svg, true);
    body.style.fontSize = `${fontSize}px`;
    body.style.maxWidth = '100%';
    body.style.height = 'auto';
    body.setAttribute('role', 'img');
    body.setAttribute('aria-label', '报告公式');
    if (display) {
      body.style.display = 'block';
      body.style.marginInline = 'auto';
    }
    math.replaceWith(body);
  }
}
