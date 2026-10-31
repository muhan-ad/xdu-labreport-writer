import test from 'node:test';
import assert from 'node:assert/strict';
import {jsonExportFilename, stageJsonExport} from '../src/domain/json-export.ts';

const fixture = () => {
  const files = new Map(), shared = [], removed = [];
  const port = {
    write: async (path, text) => {files.set(path, text);return {uri:'file:///'+path};},
    read: async path => files.get(path),
    remove: async path => {removed.push(path);files.delete(path);},
    share: async (uri,name,title) => {shared.push({uri,name,title});},
  };
  return {files, shared, removed, port};
};

test('same-named exports have separate verified files and retain exact Chinese JSON', async () => {
  const f=fixture(), first=JSON.stringify({实验:'甲',数据:[1,2]},null,2), second=JSON.stringify({实验:'乙',数据:[3]},null,2);
  await stageJsonExport('测量数据',first,'导出实验数据',f.port);
  await stageJsonExport('测量数据',second,'导出实验数据',f.port);
  const paths=[...f.files.keys()];
  assert.equal(paths.length,2);assert.notEqual(paths[0],paths[1]);
  assert.equal(f.files.get(paths[0]),first);assert.equal(f.files.get(paths[1]),second);
  assert.equal(f.shared[0].name,'测量数据.json');assert.equal(f.shared[0].title,'导出实验数据');
});

test('a failed readback or missing URI prevents sharing and removes the incomplete file', async () => {
  for (const failure of ['mismatch','uri','read']) {
    const f=fixture(),write=f.port.write;
    if(failure==='uri')f.port.write=async(path,text)=>{await write(path,text);return {uri:''};};
    if(failure==='mismatch')f.port.read=async()=>'{"changed":true}';
    if(failure==='read')f.port.read=async()=>{throw Error('读取失败');};
    await assert.rejects(stageJsonExport('test','{"test":1}','导出',f.port));
    assert.equal(f.shared.length,0);assert.equal(f.files.size,0);assert.equal(f.removed.length,1);
  }
});

test('share cancellation is clear and staged files remain available to recipients', async () => {
  const f=fixture();f.port.share=async()=>{throw Error('Share canceled');};
  await assert.rejects(stageJsonExport('test','{}','导出',f.port),/已取消分享/);
  assert.equal(f.files.size,1);
});

test('unsafe filename characters and reserved names are converted without changing the content', () => {
  assert.equal(jsonExportFilename('../A\\B:*'),'.._A_B__.json');
  assert.equal(jsonExportFilename('CON'),'实验-CON.json');
  assert.equal(jsonExportFilename('...'),'实验数据.json');
  assert.equal(Array.from(jsonExportFilename('试'.repeat(150))).length,105);
});
