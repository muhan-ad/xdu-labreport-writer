'use strict';
// Runs in an opaque-origin sandbox: no preload, Node or parent document access.
document.addEventListener('click', event => event.preventDefault(), true);
window.addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'preview') return;
  try {
    const binary = atob(event.data.buffer);
    if (binary.length > 32 * 1024 * 1024) throw Error('报告过大');
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    await docx.renderAsync(bytes.buffer, document.getElementById('report'), null,
      { inWrapper: true, ignoreWidth: true, breakPages: false, useBase64URL: true, renderAltChunks: false });
    parent.postMessage({ type: 'preview-result', ok: true }, '*');
  } catch (e) { parent.postMessage({ type: 'preview-result', ok: false }, '*'); }
}, { once: true });
