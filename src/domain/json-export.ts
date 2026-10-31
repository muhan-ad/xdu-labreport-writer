export interface JsonExportPort {
  write(path: string, text: string): Promise<{uri: string}>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  share(uri: string, name: string, title: string): Promise<void>;
}

export function jsonExportFilename(name: string) {
  let stem = Array.from(name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').trim())
    .slice(0, 100).join('').replace(/[. ]+$/g, '') || '实验数据';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = '实验-' + stem;
  return stem + '.json';
}

export async function stageJsonExport(name: string, text: string, title: string, port: JsonExportPort) {
  const filename = jsonExportFilename(name);
  const path = `exports/json-${crypto.randomUUID()}/${filename}`;
  let uri: string;
  try {
    uri = (await port.write(path, text)).uri;
    if (!uri || await port.read(path) !== text) throw Error('导出文件写入核对失败，请重试');
  } catch (error) {
    await port.remove(path).catch(() => {});
    throw error;
  }
  // A receiving app can access the shared file after the share sheet closes.
  try { await port.share(uri, filename, title); }
  catch (error) {
    if (error instanceof Error && error.message === 'Share canceled') throw Error('已取消分享');
    throw error;
  }
}
