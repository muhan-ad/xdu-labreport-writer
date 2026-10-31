import {privateStore} from '../../src/platform/storage.ts';
import {Repository} from '../../src/domain/repository.ts';
const original=privateStore.read.bind(privateStore),write=privateStore.write.bind(privateStore);let fail=true,failWrites=false;
export async function start(){await new Repository(privateStore).saveProfile({name:'原姓名',studentId:'001234',className:'测试班'});privateStore.read=async key=>{if(fail&&key.startsWith('profile-'))throw Error('模拟本机读取失败');return original(key);};privateStore.write=async(key,value)=>{if(failWrites&&key.startsWith('profile-'))return;await write(key,value);};await import('../../src/main.ts');}
export function restore(){fail=false;}
export function blockWrites(value:boolean){failWrites=value;}
