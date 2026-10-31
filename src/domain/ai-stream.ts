export type AIStreamKind='content'|'reasoning'|'stall';
export interface AIStreamEvent {id:string;seq:number;kind:AIStreamKind;delta:string;}
export interface AIStreamObserver {
 onEvent?:(event:AIStreamEvent)=>void;
 /** True keeps the same request alive; false stops it without another submission. */
 onStall?:()=>Promise<boolean>;
}
export function validAIStreamEvent(raw:unknown):raw is AIStreamEvent {
 const e=raw as AIStreamEvent;return !!e&&typeof e.id==='string'&&Number.isSafeInteger(e.seq)&&e.seq>0&&['content','reasoning','stall'].includes(e.kind)&&typeof e.delta==='string'&&e.delta.length<=262144&&(e.kind!=='stall'||e.delta==='');
}
