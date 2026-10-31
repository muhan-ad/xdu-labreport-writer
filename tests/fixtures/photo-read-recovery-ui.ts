import {privateStore} from '../../src/platform/storage.ts';
import {Filesystem,Directory} from '@capacitor/filesystem';
import '../../src/main.ts';
const original = privateStore.read.bind(privateStore);
let fail = false;
privateStore.read = async key => {if (fail && key.startsWith('photo-')) throw Error('模拟照片索引读取失败');return original(key);};
export const failPhotoRead = (value:boolean) => {fail = value;};
let saved:{path:string;data:string}|null=null;
export async function removeTestPhoto(id:string){const directory=Directory.LibraryNoCloud,base=`lab-maker/v1/photos/${id}`,list=await Filesystem.readdir({path:base,directory}),path=base+'/'+list.files[0].name,result=await Filesystem.readFile({path,directory});if(typeof result.data!=='string')throw Error('Unexpected browser file');saved={path,data:result.data};await Filesystem.deleteFile({path,directory});}
export async function restoreTestPhoto(){if(!saved)throw Error('No test photo');await Filesystem.writeFile({path:saved.path,data:saved.data,directory:Directory.LibraryNoCloud,recursive:true});}
