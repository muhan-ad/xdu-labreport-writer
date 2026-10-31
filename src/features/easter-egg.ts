import {eggFrame} from '../easter-egg/frame.ts';
import {emptyEggStats,validEggStats,effectIds,effectMaxMs,officialEggLink,type EggStats} from '../domain/easter-egg.ts';
interface Port {load():EggStats;save(stats:EggStats):void;audio(signal:AbortSignal):Promise<{ok:boolean;mime?:string;data?:string}>;open(url:string):Promise<void>;home():void;}
export class EasterEggView {
 private host:HTMLElement|null=null;private frame:HTMLIFrameElement|null=null;private token='';private lifetime:AbortController|null=null;private timer:ReturnType<typeof setTimeout>|undefined;private audioController:AbortController|null=null;private audioPromise:Promise<{ok:boolean;mime?:string;data?:string}>|null=null;private stats=emptyEggStats();private stage=0;private running=false;private ready=false;private diagnostics:unknown=null;
 private beforeRun:EggStats|null=null;
 constructor(private port:Port,private testing=false){}
 get isRunning(){return this.running;}get confirmationStage(){return this.stage;}get isReady(){return this.ready;}get diagnostic(){return this.diagnostics;}
 mount(host:HTMLElement){this.leave();this.host=host;try{const saved=this.port.load();this.stats=validEggStats(saved)?{count:saved.count,last:saved.last,effects:{...saved.effects}}:emptyEggStats();}catch{this.stats=emptyEggStats();}
  host.innerHTML='<p data-egg-status role="status">正在准备…</p><iframe title="请勿点击彩蛋" sandbox="allow-scripts" allow="autoplay" referrerpolicy="no-referrer" class="egg-frame"></iframe><button class="button egg-exit" data-egg-exit hidden>退出效果</button>';
  this.frame=host.querySelector<HTMLIFrameElement>('iframe')!;this.token=crypto.randomUUID();this.lifetime=new AbortController();const signal=this.lifetime.signal;
  window.addEventListener('message',event=>{if(event.source!==this.frame?.contentWindow||event.data?.type!=='lab-egg'||event.data.token!==this.token)return;void this.message(event.data.action,event.data.data).catch(()=>this.stop(true));},{signal});
  host.querySelector('[data-egg-exit]')!.addEventListener('click',()=>this.stop(true),{signal});document.addEventListener('visibilitychange',()=>{if(document.hidden)this.background();},{signal});
  window.addEventListener('resize',()=>{if(this.running)this.stop(true);},{signal});this.frame.srcdoc=eggFrame(this.token,this.stats,this.testing);this.timer=setTimeout(()=>{if(!this.ready&&this.host)this.status('彩蛋页面未能准备，请重新打开或检查资源');},5000);
 }
 private status(text:string){const element=this.host?.querySelector<HTMLElement>('[data-egg-status]');if(element){element.textContent=text;element.hidden=!text;}}
 private post(action:string,data:unknown={}){this.frame?.contentWindow?.postMessage({token:this.token,action,data},'*');}
 private prepareAudio(){if(!this.audioPromise){this.audioController=new AbortController();this.audioPromise=this.port.audio(this.audioController.signal).catch(()=>({ok:false}));}return this.audioPromise;}
 private async message(action:string,data:any){
  if(action==='ready'){this.ready=true;clearTimeout(this.timer);this.status('');}
  else if(action==='stage'&&Number.isInteger(data?.stage)&&data.stage>=0&&data.stage<=3)this.stage=data.stage;
  else if(action==='stats'&&validEggStats(data)){this.stats={count:data.count,last:data.last,effects:{...data.effects}};try{this.port.save(this.stats);}catch{/* The effect can still run without optional statistics persistence. */}}
  else if(action==='prepare-audio')void this.prepareAudio();
  else if(action==='audio'){const token=this.token,result=await this.prepareAudio();if(token!==this.token)return;if(!result.ok){const host=this.host!,old=this.beforeRun;if(old){this.stats=old;try{this.port.save(old);}catch{}}this.leave();host.innerHTML='<section class="error-card"><p>彩蛋音频未能读取，请检查资源后重试。</p><a class="button secondary" href="#/resource-check">检查资源</a><button class="button secondary" data-egg-retry>重试</button></section>';host.querySelector('[data-egg-retry]')!.addEventListener('click',()=>this.mount(host));return;}this.post('audio-result',result);}
  else if(action==='start'&&effectIds.includes(data?.id)&&!this.running){this.beforeRun=structuredClone(this.stats);this.running=true;this.stage=0;this.frame!.classList.add('egg-running');this.host!.querySelector<HTMLElement>('[data-egg-exit]')!.hidden=false;clearTimeout(this.timer);this.timer=setTimeout(()=>this.stop(true),effectMaxMs(data.id)+250);this.post('go');}
  else if(action==='finished'||action==='exit')this.stop(true);
  else if(action==='error')this.status('效果未能完成，可退出后重试');
  else if(action==='open'&&this.running&&data?.url===officialEggLink)await this.port.open(officialEggLink);
  else if(action==='diagnostic'&&this.testing)this.diagnostics=data;
 }
 back(){if(this.running){this.stop(true);return true;}if(this.stage){this.post('back');this.stage=0;return true;}return false;}
 background(){if(this.frame)this.stop(true);}
 stop(home=false){this.leave();if(home)this.port.home();}
 leave(){clearTimeout(this.timer);this.lifetime?.abort();this.audioController?.abort();this.audioPromise=null;this.audioController=null;this.frame?.remove();this.frame=null;this.host=null;this.running=false;this.ready=false;this.stage=0;this.token='';this.diagnostics=null;this.beforeRun=null;}
 testRun(id:string){if(this.testing&&effectIds.includes(id as typeof effectIds[number]))this.post('test-run',{id});}
 inspect(id:string){if(this.testing)this.post('inspect',{id});}
 probeNetwork(url:string){if(this.testing)this.post('probe-network',{url});}
}
