import {defaultAIPreferences,validAIPreferences,type AIPreferences} from '../domain/ai-preferences.ts';
import {defaultAIKnowledgePolicy,validAIKnowledgePolicy,type AIKnowledgePolicy} from '../domain/ai-knowledge-policy.ts';
interface PreferencesPort {
 load:(id:string)=>Promise<AIPreferences>;save:(id:string,p:AIPreferences)=>Promise<void>;
 knowledge:{load:()=>Promise<AIKnowledgePolicy>;save:(p:AIKnowledgePolicy)=>Promise<void>};
}
export class AIPreferencesView {
 private host:HTMLElement|null=null;private token=0;private lifetime:AbortController|null=null;private busy=false;private dirty=false;private policyDirty=false;private disabled=false;private loaded=false;private value=defaultAIPreferences();private policy=defaultAIKnowledgePolicy();private id='';
 constructor(private port:PreferencesPort,private changed:()=>void){}
 get isSaving(){return this.busy;}get hasUnsaved(){return this.dirty||this.policyDirty;}
 setDisabled(value:boolean){this.disabled=value;this.controls();}
 leave(){this.token++;this.lifetime?.abort();this.host=null;this.busy=false;this.dirty=false;this.policyDirty=false;}
 mount(host:HTMLElement,id:string){
  this.leave();this.host=host;this.id=id;this.loaded=false;this.lifetime=new AbortController();host.dataset.aiPreferences='';
  host.innerHTML='<section class="report-options"><label class="ai-check"><input type="checkbox" data-knowledge-policy checked><span>限定知识库（全部实验）</span></label></section><section class="report-options"><h3>本实验 AI 要求</h3><label class="ai-field">写作风格<select data-preference="style"><option value="rigorous">严谨学术</option><option value="concise">简洁明了</option><option value="detailed">详细充实</option></select></label><label class="ai-field">自定义要求<textarea data-preference="instruction" rows="3" maxlength="2000" placeholder="例如：误差分析分点，语言简洁"></textarea></label><div class="ai-inline"><button class="button secondary compact" data-preference-action="default">恢复默认</button><button class="button secondary compact" data-preference-action="retry" hidden>重试</button><span data-preference-status role="status"></span></div></section>';
  const signal=this.lifetime.signal;
  host.addEventListener('input',event=>{if(!this.loaded||this.busy||this.disabled||!(event.target as Element).matches('[data-preference]'))return;this.dirty=true;this.message('离开输入框后保存');this.changed();},{signal});
  host.addEventListener('focusout',event=>{if((event.relatedTarget as Element|null)?.matches('[data-knowledge-policy]'))return;if(this.hasUnsaved)void this.save();},{signal});
  host.addEventListener('change',event=>{if(!this.loaded||this.busy||this.disabled)return;if((event.target as Element).matches('[data-knowledge-policy]')){this.policyDirty=true;this.changed();}if(this.hasUnsaved)void this.save();},{signal});
  host.addEventListener('click',event=>{const action=(event.target as Element).closest<HTMLElement>('[data-preference-action]')?.dataset.preferenceAction;if(!action||this.busy||this.disabled)return;if(action==='default'){if(!this.loaded){void this.resetUnread();return;}this.value=defaultAIPreferences();this.fillPreferences();this.dirty=true;void this.save();}else void(this.loaded?this.save():this.load());},{signal});
  void this.load();
 }
 private controls(){this.host?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('input,select,textarea,button').forEach(e=>e.disabled=this.busy||this.disabled||(!this.loaded&&!['retry','default'].includes(e.dataset.preferenceAction??'')));}
 private message(text:string,error=false){const node=this.host?.querySelector<HTMLElement>('[data-preference-status]');if(node){node.textContent=text;node.classList.toggle('ocr-warning',error);}}
 private fillPreferences(){if(!this.host)return;this.host.querySelector<HTMLSelectElement>('[data-preference=style]')!.value=this.value.style;this.host.querySelector<HTMLTextAreaElement>('[data-preference=instruction]')!.value=this.value.instruction;}
 private fill(){this.fillPreferences();if(this.host)this.host.querySelector<HTMLInputElement>('[data-knowledge-policy]')!.checked=this.policy.kbOnly;}
 private retry(show:boolean){const button=this.host?.querySelector<HTMLButtonElement>('[data-preference-action=retry]');if(button)button.hidden=!show;}
 private async load(){
  if(this.busy)return;const token=this.token,id=this.id;this.busy=true;this.controls();this.changed();
  try{const [value,policy]=await Promise.all([this.port.load(id),this.port.knowledge.load()]);if(!validAIPreferences(value)||!validAIKnowledgePolicy(policy))throw Error('AI 要求无法核实');if(token!==this.token)return;this.value=value;this.policy=policy;this.loaded=true;this.fill();this.message('');this.retry(false);}
  catch{if(token===this.token){this.message('读取失败，请重试',true);this.retry(true);}}
  finally{if(token===this.token){this.busy=false;this.controls();this.changed();}}
 }
 // Restoring a damaged per-experiment record must not reset an unread global preference.
 private async resetUnread(){
  if(this.busy)return;const token=this.token;this.busy=true;this.controls();this.changed();
  try{const policy=await this.port.knowledge.load();if(!validAIKnowledgePolicy(policy))throw Error('知识库设置无法核实');if(token!==this.token)return;this.policy=policy;this.value=defaultAIPreferences();this.loaded=true;this.fill();this.dirty=true;}
  catch{if(token===this.token){this.message('知识库设置读取失败，请重试',true);this.retry(true);}}
  finally{if(token===this.token){this.busy=false;this.controls();this.changed();}}
  if(token===this.token&&this.loaded)await this.save();
 }
 private async save(){
  if(!this.host||this.busy||!this.loaded||!this.hasUnsaved)return;
  const value={version:1 as const,style:this.host.querySelector<HTMLSelectElement>('[data-preference=style]')!.value,instruction:this.host.querySelector<HTMLTextAreaElement>('[data-preference=instruction]')!.value};
  const policy={version:1 as const,kbOnly:this.host.querySelector<HTMLInputElement>('[data-knowledge-policy]')!.checked};
  if(!validAIPreferences(value)||!validAIKnowledgePolicy(policy)){this.message('要求最多 2000 字，请检查风格',true);return;}
  const token=this.token,id=this.id;this.busy=true;this.controls();this.changed();
  try{
   if(this.dirty){await this.port.save(id,value);if(token!==this.token)return;this.value=value;this.dirty=false;}
   if(this.policyDirty){await this.port.knowledge.save(policy);if(token!==this.token)return;this.policy=policy;this.policyDirty=false;}
   this.message('已保存');this.retry(false);
  }catch{if(token===this.token){this.message('保存失败，内容已保留',true);this.retry(true);}}
  finally{if(token===this.token){this.busy=false;this.controls();this.changed();}}
 }
}
