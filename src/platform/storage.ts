import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { Store } from "../domain/repository.ts";
import type { Photo } from "../domain/types.ts";
const root = "lab-maker/v1",
  directory = Directory.LibraryNoCloud;
const photoVerifier = registerPlugin<{verifyPhoto(value:{experimentId:string;file:string;bytes:number;sha256:string}):Promise<{verified:boolean}>}>("LabReportFiles");
const photoDigest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map(b => b.toString(16).padStart(2,"0")).join("");
const missing = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return (
    x?.code === "OS-PLUG-FILE-0008" ||
    /does not exist|not found/i.test(x?.message ?? "")
  );
};
const keyPath = (key: string) => {
  if (
    !/^(developer-settings|debug-operation|debug-backup|data-active|data-floor|school-preload|data-bundle-[a-f0-9]{64}|record-[a-f0-9]{12}|reset-journal-[a-f0-9]{12}|ocr-[a-f0-9]{12}|profile|api-tutorial|ai-skills|ai-knowledge-policy|ai-preferences-[a-f0-9]{12}|variant-library-[a-f0-9]{12}|variant-entry-[a-f0-9]{12}-[a-f0-9]{64}|history-[a-f0-9]{12}|history-item-[a-f0-9]{12}-[a-f0-9-]{36}|plot-history-[a-f0-9]{12}|plot-item-[a-f0-9]{12}-[a-f0-9-]{36}|photo-[a-f0-9]{12}|report-[a-f0-9]{12}|options-[a-f0-9]{12}|filters-[a-f0-9]{64})-[ab]$/.test(
      key,
    )
  )
    throw Error("存储名称无效");
  return `${root}/${key}.json`;
};
export const privateStore: Store = {
  async read(key) {
    try {
      if(key.startsWith('data-')||key.startsWith('ocr-')){const info=await Filesystem.stat({path:keyPath(key),directory});const limit=key.startsWith('data-bundle-')?16*1024*1024+65536:key.startsWith('ocr-')?600000:65536;if(!Number.isSafeInteger(info.size)||info.size<0||info.size>limit)throw Error('本机存储文件过大');}
      const r = await Filesystem.readFile({
        path: keyPath(key),
        directory,
        encoding: Encoding.UTF8,
      });
      if (typeof r.data !== "string") throw Error("本机数据格式异常");
      return r.data;
    } catch (e) {
      if (missing(e)) return null;
      throw Error("无法读取本机存储，请重试");
    }
  },
  async write(key, value) {
    await Filesystem.writeFile({
      path: keyPath(key),
      directory,
      data: value,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  },
  async remove(key) {
    try {
      await Filesystem.deleteFile({ path: keyPath(key), directory });
    } catch (e) {
      if (!missing(e)) throw e;
    }
  },
};
export async function storePhoto(id: string, file: File): Promise<Photo> {
  if (
    !/^[a-f0-9]{12}$/.test(id) ||
    file.size < 1 ||
    file.size > 8 * 1024 * 1024
  )
    throw Error("请选择不超过 8 MB 的原始数据照片");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime =
    bytes[0] === 255 && bytes[1] === 216
      ? "image/jpeg"
      : bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71
        ? "image/png"
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          ? "image/webp"
          : "";
  if (!mime) throw Error("仅支持 JPEG、PNG 或 WebP 图片");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("照片读取失败"));
    reader.readAsDataURL(file);
  });
  const ext =
      mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp",
    path = `photos/${id}/${crypto.randomUUID()}.${ext}`;
  const original = new Uint8Array(await file.arrayBuffer()), sha256 = await photoDigest(original), fullPath = `${root}/${path}`;
  try {
    await Filesystem.writeFile({path: fullPath, directory, data, recursive: true});
    if (Capacitor.getPlatform() === "android") {
      const result = await photoVerifier.verifyPhoto({experimentId:id, file:path.split("/").pop()!, bytes:original.length, sha256});
      if (result?.verified !== true) throw Error("照片文件回读未能核实，请重试添加");
    } else {
      const info = await Filesystem.stat({path:fullPath,directory});
      const length = Capacitor.getPlatform() === "web" ? Math.ceil(original.length / 3) * 4 : original.length;
      if (info.type !== "file" || info.size !== length) throw Error("照片文件回读未能核实，请重试添加");
      const result = await Filesystem.readFile({path:fullPath,directory});
      const copy = typeof result.data === "string" ? Uint8Array.from(atob(result.data), c => c.charCodeAt(0)) : new Uint8Array(await result.data.arrayBuffer());
      if (copy.length !== original.length || await photoDigest(copy) !== sha256) throw Error("照片文件回读未能核实，请重试添加");
    }
  } catch (error) {
    await Filesystem.deleteFile({path:fullPath,directory}).catch(() => {});
    throw error;
  }
  return { path, mime, name: file.name.slice(0, 120) };
}
export async function photoUrl(photo: Photo) {
  if (!/^photos\/[a-f0-9]{12}\/[a-f0-9-]+\.(jpg|png|webp)$/.test(photo.path)) throw Error("原始照片信息异常");
  const path = `${root}/${photo.path}`;
  const info = await Filesystem.stat({path, directory});
  const max = Capacitor.getPlatform() === "web" ? Math.ceil(8 * 1024 * 1024 / 3) * 4 : 8 * 1024 * 1024;
  if (info.type !== "file" || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > max) throw Error("原始照片文件异常");
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.getUri({ path, directory });
    return Capacitor.convertFileSrc(r.uri);
  }
  const r = await Filesystem.readFile({ path, directory });
  if (typeof r.data === "string") return `data:${photo.mime};base64,${r.data}`;
  return URL.createObjectURL(r.data);
}
export async function deletePhotoFile(photo: Photo) {
  try {
    await Filesystem.deleteFile({ path: `${root}/${photo.path}`, directory });
  } catch (e) {
    if (!missing(e)) throw e;
  }
}
export async function deletePhotos(id: string) {
  if (!/^[a-f0-9]{12}$/.test(id)) throw Error("实验标识无效");
  try {
    await Filesystem.rmdir({
      path: `${root}/photos/${id}`,
      directory,
      recursive: true,
    });
  } catch (e) {
    if (!missing(e)) throw e;
  }
}
export async function exportJson(name: string, data: unknown, dialogTitle = "导出实验数据") {
  const text = JSON.stringify(data, null, 2);
  if (typeof text !== 'string') throw Error('导出数据无法转换为 JSON');
  if (Capacitor.isNativePlatform()) {
    const {stageJsonExport} = await import('../domain/json-export.ts');
    await stageJsonExport(name, text, dialogTitle, {
      write: (path, value) => Filesystem.writeFile({path, directory:Directory.Cache, data:value, encoding:Encoding.UTF8, recursive:true}),
      read: async path => {const value = (await Filesystem.readFile({path, directory:Directory.Cache, encoding:Encoding.UTF8})).data;return typeof value === 'string' ? value : await value.text();},
      remove: path => Filesystem.deleteFile({path, directory:Directory.Cache}),
      share: async (uri, filename, title) => {await Share.share({title:filename, files:[uri], dialogTitle:title});},
    });
  } else {
    const {jsonExportFilename} = await import('../domain/json-export.ts');
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = jsonExportFilename(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
export async function clearAIHistoryFiles(id: string) {
  if (!/^[a-f0-9]{12}$/.test(id)) throw Error('实验标识无效');
  let names: string[];
  try { names = (await Filesystem.readdir({path:root,directory})).files.map(f=>f.name); } catch(e) { if(missing(e))return;throw e; }
  const allowed=new RegExp('^(history-'+id+'|history-item-'+id+'-[a-f0-9-]{36})-[ab][.]json$');
  for(const name of names)if(allowed.test(name))await Filesystem.deleteFile({path:root+'/'+name,directory});
}
export async function clearPlotHistoryFiles(id:string){
  if(!/^[a-f0-9]{12}$/.test(id))throw Error('实验标识无效');let names:string[];
  try{names=(await Filesystem.readdir({path:root,directory})).files.map(f=>f.name);}catch(e){if(missing(e))return;throw e;}
  const allowed=new RegExp('^(plot-history-'+id+'|plot-item-'+id+'-[a-f0-9-]{36})-[ab][.]json$');
  for(const name of names)if(allowed.test(name))await Filesystem.deleteFile({path:root+'/'+name,directory});
}
export async function clearVariantLibraryFiles(id:string){if(!/^[a-f0-9]{12}$/.test(id))throw Error('实验标识无效');let names:string[];try{names=(await Filesystem.readdir({path:root,directory})).files.map(f=>f.name);}catch(e){if(missing(e))return;throw e;}const allowed=new RegExp('^(variant-library-'+id+'|variant-entry-'+id+'-[a-f0-9]{64})-[ab][.]json$');for(const name of names)if(allowed.test(name))await Filesystem.deleteFile({path:root+'/'+name,directory});}
