/* Opaque-origin preview: receives only the generated file, with external content disabled. */
document.addEventListener("click", (event) => event.preventDefault(), true);
window.addEventListener('message',async event=>{
 if(event.source!==parent||event.data?.type!=='report-preview-fonts'||!Array.isArray(event.data.fonts))return;
 for(const font of event.data.fonts){
  if(!(font.bytes instanceof ArrayBuffer)||font.bytes.byteLength>32*1024*1024)continue;
  for(const name of font.names||[])if(['宋体','SimSun','黑体','SimHei','Cambria Math','STIX Two Math'].includes(name)){
   try{document.fonts.add(await new FontFace(name,font.bytes).load());}catch{}
  }
 }
});
parent.postMessage({type:'report-preview-fonts-ready'},'*');
const report = document.getElementById('report');
const paper = document.getElementById('paper');
let renderedToken = null;
let renderSequence = 0;
function publishSize() {
  if (renderedToken === null) return;
  const width = paper.offsetWidth;
  const availableWidth = report.clientWidth;
  if (!width || !availableWidth) return;
  const scale = Math.min(1, availableWidth / width);
  const height = Math.ceil(Math.max(paper.offsetHeight, paper.scrollHeight) * scale) + 24;
  paper.style.left = `${Math.max(0, (availableWidth - width * scale) / 2)}px`;
  paper.style.transform = `scale(${scale})`;
  if (report.style.height === `${height}px`) return;
  report.style.height = `${height}px`;
  parent.postMessage({
    type: 'report-preview-size',
    token: renderedToken,
    height: height + 2,
  }, '*');
}
if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver(publishSize);
  observer.observe(report);
  observer.observe(paper);
}
window.addEventListener('resize', publishSize);
window.addEventListener(
  "message",
  async (event) => {
    if (
      event.source !== parent ||
      event.data?.type !== "report-preview" ||
      !(event.data.bytes instanceof ArrayBuffer)
    )
      return;
    const sequence = ++renderSequence;
    const staging = document.createElement('div');
    staging.className = 'pdf-staging';
    const source = document.createElement('div');
    source.id = 'pdf-source';
    staging.append(source);
    report.append(staging);
    try {
      if (event.data.bytes.byteLength > 24 * 1024 * 1024)
        throw Error("报告过大");
      renderedToken = null;
      report.style.height = '';
      paper.replaceChildren();
      await docx.renderAsync(
        event.data.bytes,
        source,
        null,
        {
          inWrapper: true,
          ignoreWidth: false,
          breakPages: false,
          useBase64URL: true,
          renderAltChunks: false,
        },
      );
      const current = () => sequence === renderSequence;
      await renderReportPages(source, page => {
        paper.append(page);
        renderedToken = event.data.token;
        publishSize();
      }, current);
      if (!current()) return;
      parent.postMessage(
        { type: "report-preview-result", token: event.data.token, ok: true },
        "*",
      );
    } catch (error) {
      if (sequence !== renderSequence) return;
      parent.postMessage(
        { type: "report-preview-result", token: event.data.token, ok: false, message: "报告预览生成失败，可外部打开 Word 报告" },
        "*",
      );
      console.error('PDF preview:', error);
    } finally {
      staging.remove();
    }
  },

);
parent.postMessage({ type: "report-preview-ready" }, "*");
