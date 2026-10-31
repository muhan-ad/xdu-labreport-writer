// Subset of original Mechvibes recording; loaded only after an explicit answer/sound gesture.
const keys=[16,17,18,19,20,21,22,23,24,25,30,31,32,33,34,35,36,37,38,44,45,46,48,49,50];
export type SoundState='idle'|'loading'|'ready'|'failed'|'off';
type Clip=readonly [number,number];
export function keyboardClips(value:unknown,duration:number):Clip[]{
 const config=value as {defines?:Record<string,unknown>};
 if(!config||typeof config!=='object'||!config.defines||!Number.isFinite(duration)||duration<=0)throw Error('音效配置无效');
 return keys.map(key=>{
  const row=config.defines![String(key)];
  if(!Array.isArray(row)||row.length!==2||!row.every(v=>typeof v==='number'&&Number.isFinite(v))||row[0]<0||row[1]<10||row[1]>1000||(row[0]+row[1])/1000>duration)throw Error('音效片段不完整');
  return [row[0]/1000,row[1]/1000] as const;
 });
}
async function resource(url:string,limit:number,signal:AbortSignal){
 const response=await fetch(url,{signal,credentials:'omit'});
 if(!response.ok)throw Error('音效读取失败');
 const data=await response.arrayBuffer();if(data.byteLength<1||data.byteLength>limit)throw Error('音效资源大小异常');return data;
}
export interface TypingSoundOptions{
 enabled?:boolean;
 context?:()=>AudioContext;
 load?:(signal:AbortSignal)=>Promise<{audio:ArrayBuffer;config:unknown}>;
 hidden?:()=>boolean;
 changed?:(state:SoundState)=>void;
}
export class TypingSound{
 enabled:boolean;state:SoundState='idle';
 private options:TypingSoundOptions;private context:AudioContext|null=null;private buffer:AudioBuffer|null=null;private clips:Clip[]=[];
 private controller:AbortController|null=null;private job:Promise<boolean>|null=null;private generation=0;private last=-Infinity;private lastKey=-1;
 private active=new Set<AudioBufferSourceNode>();
 constructor(options:TypingSoundOptions={}){this.options=options;this.enabled=options.enabled??true;}
 private status(state:SoundState){this.state=state;this.options.changed?.(state);}
 async prepare():Promise<boolean>{
  if(!this.enabled)return false;
  if(this.job)return this.job;
  const generation=this.generation,controller=new AbortController();this.controller=controller;
  const valid=()=>generation===this.generation&&this.enabled&&!controller.signal.aborted;
  this.status('loading');
  try{
   const context=this.context??(this.context=this.options.context?.()??new AudioContext({latencyHint:'interactive'}));
   // Call resume synchronously inside the user's gesture; loading is independent of disclosure text.
   const resumed=context.state==='running'?Promise.resolve():context.resume();
   this.job=(async()=>{
    try{
     if(!this.buffer){
      const data=await (this.options.load?.(controller.signal)??Promise.all([resource('/guide-audio/keyboard.wav',1024*1024,controller.signal),resource('/guide-audio/config.json',16384,controller.signal)]).then(([audio,config])=>({audio,config:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(config))})));
      if(!valid())return false;
      const buffer=await context.decodeAudioData(data.audio);
      if(!valid())return false;
      const clips=keyboardClips(data.config,buffer.duration);this.buffer=buffer;this.clips=clips;
     }
     await resumed;
     if(!valid())return false;
     if(context.state!=='running')throw Error('音频设备尚未就绪');
     this.status('ready');return true;
    }catch{if(valid())this.status('failed');return false;}
    finally{if(generation===this.generation){this.job=null;this.controller=null;}}
   })();
   // Avoid an unhandled rejection if loading fails before resume settles.
   void resumed.catch(()=>{});
   return await this.job;
  }catch{if(valid())this.status('failed');this.job=null;this.controller=null;return false;}
 }
 play(){
  const context=this.context;if(!this.enabled||this.state!=='ready'||!context||context.state!=='running'||!this.buffer||(this.options.hidden?.()??document.hidden))return;
  const now=context.currentTime;if(now-this.last<.08||this.active.size>=4)return;this.last=now;
  let index=Math.floor(Math.random()*this.clips.length);if(index===this.lastKey)index=(index+1)%this.clips.length;this.lastKey=index;
  const [offset,length]=this.clips[index],source=context.createBufferSource(),gain=context.createGain();source.buffer=this.buffer;source.playbackRate.value=.98+Math.random()*.04;
  gain.gain.setValueAtTime(.42+Math.random()*.08,now);gain.gain.setTargetAtTime(.0001,now+length-.018,.006);
  source.connect(gain);gain.connect(context.destination);this.active.add(source);
  source.onended=()=>{this.active.delete(source);source.disconnect();gain.disconnect();};
  try{source.start(now,offset,length);}catch{this.active.delete(source);source.disconnect();gain.disconnect();this.status('failed');}
 }
 stop(){for(const source of this.active){try{source.stop();}catch{}source.disconnect();}this.active.clear();}
 setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.dispose();else this.status('idle');}
 pause(){this.stop();if(this.context?.state==='running')void this.context.suspend().catch(()=>{});}
 dispose(){this.generation++;this.controller?.abort();this.controller=null;this.job=null;this.stop();const context=this.context;this.context=null;this.buffer=null;this.clips=[];this.last=-Infinity;this.lastKey=-1;if(context&&context.state!=='closed')void context.close().catch(()=>{});this.status(this.enabled?'idle':'off');}
}
