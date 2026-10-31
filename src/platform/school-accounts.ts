import {Capacitor,registerPlugin} from '@capacitor/core';
import {parseSchoolAccounts,type SchoolSystem} from '../domain/school-accounts.ts';
interface NativeSchoolAccounts {
  list():Promise<unknown>;
  save(value:{system:SchoolSystem;id?:string;account:string;password:string;label:string;confirmed:boolean}):Promise<{id:string}>;
  remove(value:{id:string;confirmed:boolean}):Promise<void>;
  reset(value:{confirmed:boolean}):Promise<void>;
}
const native=registerPlugin<NativeSchoolAccounts>('LabSchoolAccounts');
function supported(){if(Capacitor.getPlatform()!=='android')throw Error('此平台的本机账号加密存储尚未接入');}
export const schoolAccounts={
  async list(){supported();return parseSchoolAccounts(await native.list());},
  async save(value:Parameters<NativeSchoolAccounts['save']>[0]){supported();if(!value.confirmed)throw Error('请先确认在本机保存账号');return native.save(value);},
  async remove(id:string,confirmed:boolean){supported();if(!confirmed)throw Error('请确认删除账号');return native.remove({id,confirmed});},
  async reset(confirmed:boolean){supported();if(!confirmed)throw Error('请确认清空账号');return native.reset({confirmed});},
};
