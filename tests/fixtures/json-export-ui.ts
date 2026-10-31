import {exportJson} from '../../src/platform/storage.ts';
export const run = (data: unknown) => exportJson('测量数据', data, '导出实验数据');
