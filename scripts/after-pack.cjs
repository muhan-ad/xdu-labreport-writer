'use strict';
const path=require('node:path');
const {buildManifest}=require('../src/main/resource-integrity');
// Baseline unsigned builds after packing; refresh it after signing when signing is enabled.
module.exports=async context=>{
 const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources'):path.join(context.appOutDir,'resources');
 const project=path.join(__dirname,'..');await require('./resource-coverage.cjs')(project,resources,require('../package.json'));
 await buildManifest(resources,context.packager.appInfo.version);
};
