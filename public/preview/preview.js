/* Opaque-origin preview: receives only the generated file, with external content disabled. */
document.addEventListener("click", (event) => event.preventDefault(), true);
window.addEventListener(
  "message",
  async (event) => {
    if (
      event.source !== parent ||
      event.data?.type !== "report-preview" ||
      !(event.data.bytes instanceof ArrayBuffer)
    )
      return;
    try {
      if (event.data.bytes.byteLength > 24 * 1024 * 1024)
        throw Error("报告过大");
      await docx.renderAsync(
        event.data.bytes,
        document.getElementById("report"),
        null,
        {
          inWrapper: true,
          ignoreWidth: true,
          breakPages: false,
          useBase64URL: true,
          renderAltChunks: false,
        },
      );
      parent.postMessage(
        { type: "report-preview-result", token: event.data.token, ok: true },
        "*",
      );
    } catch {
      parent.postMessage(
        { type: "report-preview-result", token: event.data.token, ok: false },
        "*",
      );
    }
  },
  { once: true },
);
parent.postMessage({ type: "report-preview-ready" }, "*");
