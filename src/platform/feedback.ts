import {Capacitor,registerPlugin} from '@capacitor/core';
export type FeedbackResult={state:'sent'|'cancelled'|'unknown'};
interface NativeFeedback {submit(input:{id:string;text:string;experiment:string}):Promise<FeedbackResult>;cancel(input:{id:string}):Promise<void>;}
const native=registerPlugin<NativeFeedback>('LabFeedback');
export const feedback={async submit(input:{id:string;text:string;experiment:string}){if(Capacitor.getPlatform()!=='android')throw Error('请在安卓应用中提交反馈');const result=await native.submit(input);if(!['sent','cancelled','unknown'].includes(result.state))throw Error('反馈结果未能确认');return result;},async cancel(id:string){await native.cancel({id});}};
