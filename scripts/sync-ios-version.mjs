import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8')),android=fs.readFileSync('android/app/build.gradle','utf8');
const version=pkg.version,androidVersion=android.match(/versionName\s+"([^"]+)"/)?.[1],code=android.match(/versionCode\s+(\d+)/)?.[1];
if(!/^\d+\.\d+\.\d+$/.test(version)||version!==androidVersion||!code||Number(code)<1)throw Error('Android 和共享版本不一致，未更改 iOS 版本');
const target='ios/App/App.xcodeproj/project.pbxproj';let value=fs.readFileSync(target,'utf8');
for(const [key,next] of [['MARKETING_VERSION',version],['CURRENT_PROJECT_VERSION',code]]){
 const pattern=new RegExp(`(${key} = )[^;]+;`,'g');if([...value.matchAll(pattern)].length!==2)throw Error('iOS 版本配置数量异常：'+key);value=value.replace(pattern,`$1${next};`);
}
fs.writeFileSync(target,value);console.log(`iOS 工程版本已同步：${version} (${code})；未构建或发布`);
