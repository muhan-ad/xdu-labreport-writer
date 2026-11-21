import release from '../data/resource-release.json' with {type:'json'};
// 0.0.0 remains the storage sentinel for built-in resources, never a published data version.
export const resourceVersionLabel=(version:string)=>version==='0.0.0'?`内置资源 ${release.dataVersion}`:version;

export const resourceVersionNumber=(version:string)=>version==='0.0.0'?release.dataVersion:version;
