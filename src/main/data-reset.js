'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),atomic=require('./atomic-store'),validation=require('../shared/data-validation');
function resetData(dir,schema,backupRoot){
 const data=validation.blank(schema),errors=validation.validate(schema,data,false);
 if(errors.length)throw Error('无法建立空白表单：'+errors.join('；'));
 const disposable=name=>/^data\.json(?:\.bak|\.corrupt-[\w-]+)?$/.test(name)||/^\.ocr-last-result\.json(?:\.bak|\.corrupt-[\w-]+)?$/.test(name)||/^\.(?:lab_sections|chart-config)\.json(?:\.bak)?$/.test(name)||name==='.chart-custom.png'||/^原始数据照片\.(?:jpe?g|png|webp)$/i.test(name);
 const names=fs.readdirSync(dir).filter(disposable);
 for(const name of names)if(!fs.lstatSync(path.join(dir,name)).isFile()||fs.lstatSync(path.join(dir,name)).isSymbolicLink())throw Error('数据文件类型异常，停止清除：'+name);
 const backup=path.join(backupRoot,Date.now()+'-'+crypto.randomUUID());fs.mkdirSync(backup,{recursive:true});
 // Copy raw bytes even if the original JSON cannot be parsed. Never overwrite its recovery copy.
 for(const name of names)fs.copyFileSync(path.join(dir,name),path.join(backup,name),fs.constants.COPYFILE_EXCL);
 for(const name of names)if(name!=='data.json')fs.unlinkSync(path.join(dir,name));
 atomic.writeFile(path.join(dir,'data.json'),JSON.stringify(data,null,2),'utf8',false);
 return {data,backup};
}
module.exports={resetData};
