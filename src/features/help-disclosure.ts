import type {TypingSound} from '../platform/typing-sound.ts';
// One reveal at a time. Keep the full answer available to accessibility services.
export class HelpDisclosure{
 private frame=0;private finish:(()=>void)|null=null;private sound:TypingSound;
 private motions=new Map<HTMLDetailsElement,{animation:Animation;opening:boolean}>();private closedHeight=new WeakMap<HTMLDetailsElement,number>();
 constructor(sound:TypingSound){this.sound=sound;}
 stop(){cancelAnimationFrame(this.frame);this.frame=0;this.finish?.();this.finish=null;this.sound.stop();}
 reset(){this.stop();for(const [details,motion] of this.motions){motion.animation.cancel();details.open=motion.opening;details.style.overflow='';}this.motions.clear();}
 toggle(details:HTMLDetailsElement){
  const prior=this.motions.get(details),opening=prior?!prior.opening:!details.open,from=details.getBoundingClientRect().height;
  prior?.animation.cancel();this.motions.delete(details);this.stop();
  if(opening&&!details.open)this.closedHeight.set(details,from);
  if(opening)details.open=true;
  const summary=details.querySelector('summary')!,style=getComputedStyle(details);
  const closed=this.closedHeight.get(details)??(summary.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth));
  const to=opening?details.getBoundingClientRect().height:closed;
  details.style.overflow='hidden';const animation=details.animate([{height:from+'px'},{height:to+'px'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'}),motion={animation,opening};this.motions.set(details,motion);
  animation.onfinish=()=>{if(this.motions.get(details)!==motion)return;this.motions.delete(details);if(!opening)details.open=false;details.style.overflow='';};
 }
 open(details:HTMLDetailsElement){
  this.stop();const answer=details.querySelector<HTMLElement>('[data-help-answer]');if(!answer||!details.open)return;
  const text=answer.dataset.helpAnswer??'',chars=Array.from(text),skip=details.querySelector<HTMLButtonElement>('[data-help-complete]');
  const height=answer.getBoundingClientRect().height;answer.style.minHeight=height+'px';
  const visual=document.createElement('span');visual.setAttribute('aria-hidden','true');const accessible=document.createElement('span');accessible.className='help-answer-full';accessible.textContent=text;answer.replaceChildren(visual,accessible);answer.classList.add('help-typing');if(skip)skip.hidden=false;
  this.finish=()=>{answer.textContent=text;answer.classList.remove('help-typing');answer.style.minHeight='';if(skip)skip.hidden=true;};
  const duration=Math.min(2800,Math.max(350,chars.length*24));let start:number|undefined,lastCount=0;
  const tick=(now:number)=>{
   if(!details.open||!answer.isConnected||document.hidden){this.stop();return;}
   start??=now;const count=Math.min(chars.length,Math.ceil((now-start)/duration*chars.length));visual.textContent=chars.slice(0,count).join('');
   if(count>lastCount&&chars.slice(lastCount,count).some(c=>!/\s/.test(c)))this.sound.play();lastCount=count;
   if(count<chars.length)this.frame=requestAnimationFrame(tick);else this.stop();
  };
  this.frame=requestAnimationFrame(tick);
 }
}
