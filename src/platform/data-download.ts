import { Capacitor, registerPlugin } from '@capacitor/core';
import { DataDownload } from '../domain/data-download.ts';
import type { DataManifest } from '../domain/data-package.ts';
import { dataUpdateStore } from './data-state.ts';
import { MobileDataRequests, type DataNative } from './data-request.ts';

const requests = new MobileDataRequests(registerPlugin<DataNative>('LabDataUpdates'), () => Capacitor.getPlatform());
const localPreview = () => import.meta.env.DEV && Capacitor.getPlatform() === 'web';

async function readPreview(path: string, limit: number, signal: AbortSignal, progress: (bytes: number, total: number) => void) {
  const response = await fetch('/__lab-data/' + path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    redirect: 'error',
    cache: 'no-store',
  });
  if (response.status === 404) return { found: false };
  if (!response.ok || !response.body) throw Error('无法读取在线更新资源');
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.length > limit) throw Error('更新资源超过大小限制');
      buffer.set(value, bytes);
      bytes += value.length;
      progress(bytes, 0);
    }
    return { found: true, body: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)), bytes };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const transfer = new DataDownload({
  manifest: (signal, progress) => localPreview()
    ? readPreview('mobile-data-manifest.json', 65536, signal, progress)
    : requests.manifest(signal, progress),
  bundle: (manifest, signal, progress) => localPreview()
    ? readPreview('mobile-data/data-' + manifest.dataVersion + '.json', manifest.size, signal, progress)
    : requests.bundle(manifest, signal, progress),
  inspectManifest: async raw => (await dataUpdateStore()).inspectManifest(raw),
  inspect: async envelope => (await dataUpdateStore()).inspect(envelope),
});

export const onlineDataUpdates = {
  onlineAvailable: () => localPreview() || Capacitor.getPlatform() === 'android',
  checkOnline: (signal: AbortSignal, progress: (bytes: number, total: number) => void) => transfer.check(signal, progress),
  download: (manifest: DataManifest, signal: AbortSignal, progress: (bytes: number, total: number) => void) => transfer.download(manifest, signal, progress),
};
