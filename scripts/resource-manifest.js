'use strict';
const path=require('node:path'),{buildManifest}=require('../src/main/resource-integrity');
const root=path.join(__dirname,'..'),version=require('../package.json').version;
const resources=process.argv[2]||path.join(root,'dist/win-unpacked/resources');
require('./resource-coverage.cjs')(root,resources,require('../package.json')).then(()=>buildManifest(resources,version)).then(m=>console.log('Resource manifest: '+m.files.length+' files')).catch(e=>{console.error(e.message);process.exitCode=1;});
