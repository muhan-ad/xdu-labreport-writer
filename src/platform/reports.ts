import { safeReportFilename } from "../domain/reports.ts";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { SavedReport } from "../domain/reports.ts";
import type { Photo } from "../domain/types.ts";
import type { EngineResult } from "../engine/client.ts";
const directory = Directory.LibraryNoCloud,
  root = "lab-maker/v1";
const idOK = (id: string) => {
  if (!/^[a-f0-9]{12}$/.test(id)) throw Error("实验标识无效");
};
function generationPath(id: string, generation: string) {
  idOK(id);
  if (!/^[a-f0-9-]{36}$/.test(generation)) throw Error("报告文件标识无效");
  return `${root}/reports/${id}/${generation}`;
}
const missing = (e: unknown) =>
  /does not exist|not found/i.test((e as Error)?.message ?? "") ||
  (e as { code: string })?.code === "OS-PLUG-FILE-0008";
export function binaryBase64(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
async function readBinary(path: string) {
  const result = await Filesystem.readFile({ path, directory });
  if (typeof result.data !== "string")
    return new Uint8Array(await result.data.arrayBuffer());
  return Uint8Array.from(atob(result.data), (x) => x.charCodeAt(0));
}
export async function reportBytes(report: SavedReport) {
  return readBinary(
    generationPath(report.experimentId, report.generation) + "/report.docx",
  );
}
export async function reportSourceUri(report: SavedReport) {
  const result = await Filesystem.getUri({
    path:
      generationPath(report.experimentId, report.generation) + "/report.docx",
    directory,
  });
  return result.uri;
}
export async function reportFileSize(report: SavedReport) {
  const stat = await Filesystem.stat({ path: generationPath(report.experimentId, report.generation) + "/report.docx", directory });
  if (stat.type !== "file" || stat.size < 1 || stat.size > 128 * 1024 * 1024) throw Error("报告文件大小异常，请重新生成");
  return stat.size;
}
const reportFiles = registerPlugin<{
  open(v: {experimentId: string; generation: string}): Promise<void>;
  verifyStaged(v:{experimentId:string;generation:string;file:string;bytes:number;sha256:string}):Promise<{verified:boolean}>;
}>("LabReportFiles");
export async function openReport(report: SavedReport) {
  if (Capacitor.getPlatform() === "android") return reportFiles.open({experimentId: report.experimentId, generation: report.generation});
  if (Capacitor.getPlatform() === "ios") return shareReport(report);
  throw Error("当前平台请使用“保存 / 分享”打开报告");
}
export async function stagedReportBytes(path: string) {
  if (!/^report-uploads\/[a-f0-9-]{36}\/report\.docx$/.test(path))
    throw Error("待上传报告路径无效");
  const result = await Filesystem.readFile({
    path,
    directory: Directory.Cache,
  });
  return typeof result.data === "string"
    ? Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))
    : new Uint8Array(await result.data.arrayBuffer());
}
export async function reportChartBytes(report: SavedReport, file: string) {
  if (!report.charts.some((c) => c.file === file)) throw Error("图表文件无效");
  return readBinary(
    generationPath(report.experimentId, report.generation) + "/" + file,
  );
}
export async function photoBase64(photo: Photo) {
  if (!/^photos\/[a-f0-9]{12}\/[a-f0-9-]+\.(jpg|png|webp)$/.test(photo.path)) throw Error("原始照片信息异常，请重新添加照片");
  try {
    const path = `${root}/${photo.path}`, info = await Filesystem.stat({path, directory});
    const max = Capacitor.getPlatform() === "web" ? Math.ceil(8 * 1024 * 1024 / 3) * 4 : 8 * 1024 * 1024;
    if (info.type !== "file" || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > max) throw Error();
    const bytes = await readBinary(path);
    const mime = bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? "image/png" : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP" ? "image/webp" : "";
    if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024 || mime !== photo.mime) throw Error();
    return binaryBase64(bytes);
  } catch {
    throw Error("原始照片无法读取或已损坏，请重新添加后生成报告");
  }
}
export async function stageReport(
  id: string,
  generation: string,
  result: EngineResult,
) {
  const path = generationPath(id, generation);
  if (!result.docx.length) throw Error("报告文件为空，请重新生成");
  if (result.docx.length > 24 * 1024 * 1024 || result.charts.length > 32)
    throw Error("报告资源过大");
  const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const writeAndVerify=async(file:string,bytes:Uint8Array)=>{
    if(!bytes.length)throw Error("报告文件为空，请重新生成");
    const sha256=await digest(bytes),filePath=path+'/'+file;
    await Filesystem.writeFile({path:filePath,directory,data:binaryBase64(bytes),recursive:true});
    if(Capacitor.getPlatform()==='android'){
      const verified=await reportFiles.verifyStaged({experimentId:id,generation,file,bytes:bytes.length,sha256});
      if(verified?.verified!==true)throw Error("报告文件回读未能核实，请重试生成");
    }else{
      // Other platforms lack the native streaming verifier; bound the file before reading.
      const info=await Filesystem.stat({path:filePath,directory});
      // Capacitor's web filesystem stores base64 text and reports its encoded length.
      const storedLength=Capacitor.getPlatform()==='web'?Math.ceil(bytes.length/3)*4:bytes.length;
      if(info.type!=='file'||info.size!==storedLength)throw Error("报告文件回读未能核实，请重试生成");
      const copy=await readBinary(filePath);
      if(copy.length!==bytes.length||await digest(copy)!==sha256)throw Error("报告文件回读未能核实，请重试生成");
    }
  };
  await writeAndVerify("report.docx",result.docx);
  const charts = [];
  for (const [i, image] of result.charts.entries()) {
    if (image.bytes.length > 8 * 1024 * 1024) throw Error("图表资源过大");
    const file = `chart-${i + 1}.png`;
    await writeAndVerify(file,image.bytes);
    charts.push({ file, name: image.name.slice(0, 1000) });
  }
  return charts;
}
export async function removeReportGeneration(id: string, generation: string) {
  try {
    await Filesystem.rmdir({
      path: generationPath(id, generation),
      directory,
      recursive: true,
    });
  } catch (e) {
    if (!missing(e)) throw e;
  }
}
export async function pruneReportFiles(report: SavedReport) {
  const path = `${root}/reports/${report.experimentId}`;
  const entries = await Filesystem.readdir({ path, directory });
  for (const entry of entries.files)
    if (entry.name !== report.generation && /^[a-f0-9-]{36}$/.test(entry.name))
      await removeReportGeneration(report.experimentId, entry.name);
}
export async function clearReportFiles(id: string) {
  idOK(id);
  try {
    await Filesystem.rmdir({
      path: `${root}/reports/${id}`,
      directory,
      recursive: true,
    });
  } catch (e) {
    if (!missing(e)) throw e;
  }
  await clearReportExports(id);
}
export async function removeSavedReportFiles(report: SavedReport) {
  await removeReportGeneration(report.experimentId, report.generation);
  await clearReportExports(report.experimentId);
}
async function clearReportExports(id: string) {
  idOK(id);
  try {
    await Filesystem.deleteFile({
      path: `report-exports/${id}.docx`,
      directory: Directory.Cache,
    });
  } catch (e) {
    if (!missing(e)) throw e;
  }
  for (const prefix of ["report-exports", "chart-exports"]) {
    try {
      await Filesystem.rmdir({
        path: `${prefix}/${id}`,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
}
async function shareBinary(prefix: 'report-exports' | 'chart-exports', id: string, filename: string, bytes: Uint8Array, title: string) {
  idOK(id);
  const path = `${prefix}/${id}/${crypto.randomUUID()}/${filename}`;
  const result = await Filesystem.writeFile({path, directory:Directory.Cache, data:binaryBase64(bytes), recursive:true});
  if (!result.uri) {
    await Filesystem.deleteFile({path, directory:Directory.Cache}).catch(() => {});
    throw Error('分享文件准备失败，请重试');
  }
  try {
    await Share.share({title:filename, files:[result.uri], dialogTitle:title});
  } catch (error) {
    if (error instanceof Error && error.message === 'Share canceled') throw Error('已取消分享');
    throw error;
  }
}
export async function shareReport(report: SavedReport) {
  const bytes = await reportBytes(report),
    filename = safeReportFilename(report.name);
  if (Capacitor.isNativePlatform()) {
    await shareBinary('report-exports', report.experimentId, filename, bytes, '保存或分享实验报告');
  } else {
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
export async function shareChart(
  experimentId: string,
  bytes: Uint8Array,
  title: string,
) {
  idOK(experimentId);
  const name =
    (Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim())
      .slice(0, 60)
      .join("")
      .replace(/[. ]+$/, "") || "实验图表") + ".png";
  if (Capacitor.isNativePlatform()) {
    await shareBinary('chart-exports', experimentId, name, bytes, '保存或分享实验图表');
  } else {
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer], { type: "image/png" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
