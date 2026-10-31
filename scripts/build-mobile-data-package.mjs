// Local release preparation only. Does not upload, activate or inspect user storage.
import fs from 'node:fs';import path from 'node:path';import {makeMobileDataPackage,signMobileDataManifest} from './lib/mobile-data-package.mjs';
const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--data-version','--min-app-version','--notes-file','--out','--signing-key'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('参数应为 --data-version、--min-app-version、--out，及可选 --notes-file / --signing-key');options[args[i]]=args[i+1];}
if(!options['--data-version']||!options['--min-app-version']||!options['--out'])throw Error('请指定数据版本、最低应用版本和输出目录');
const pack=await makeMobileDataPackage(root,{dataVersion:options['--data-version'],minAppVersion:options['--min-app-version'],notes:options['--notes-file']?fs.readFileSync(options['--notes-file'],'utf8'):''});
const out=path.resolve(options['--out']),name='data-'+pack.manifest.dataVersion+'.json',manifestName=options['--signing-key']?'mobile-data-manifest.json':'mobile-data-manifest.unsigned.json';
if(fs.existsSync(path.join(out,name))||fs.existsSync(path.join(out,manifestName)))throw Error('目标文件已存在，请使用新的输出目录');
const manifest=options['--signing-key']?signMobileDataManifest(pack.manifest,fs.readFileSync(options['--signing-key']),fs.readFileSync(path.join(root,'src/data/update-public-key.pem'))):pack.manifest;
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,name),pack.bytes,{flag:'wx'});fs.writeFileSync(path.join(out,manifestName),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({dataVersion:manifest.dataVersion,bytes:manifest.size,sha256:manifest.sha256,signed:!!manifest.signature,activated:false,published:false}));
