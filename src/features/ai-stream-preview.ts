import type {AIStreamEvent,AIStreamObserver} from '../domain/ai-stream.ts';

function displayText(text:string){
 // The question-answer endpoint uses an internal JSON envelope. Show the answer
 // itself in the temporary preview while leaving the final reply untouched.
 if(!/^\s*\{\s*"answers"\s*:\s*\[\s*"/.test(text))return text;
 return text.replace(/^\s*\{\s*"answers"\s*:\s*\[\s*"/,'').replace(/"\s*,\s*"/g,'\n\n').replace(/"\s*\]\s*\}\s*$/,'').replace(/\\n/g,'\n').replace(/\\"/g,'"');
}
/** Transient output only. Final answer still goes through the ordinary review flow. */
export class AIStreamPreview {
 private card=document.createElement('section');private output=document.createElement('pre');private status=document.createElement('span');private wait=document.createElement('div');private pending:((value:boolean)=>void)|null=null;private text='';private trimmed=false;private closed=false;private observerDOM:MutationObserver;
 readonly observer:AIStreamObserver;
 constructor(private signal:AbortSignal,private stop:()=>void){
  this.card.className='ai-stream-preview';this.card.setAttribute('aria-label','AI 正在生成');
  const header=document.createElement('div');header.className='ai-stream-heading';this.status.setAttribute('role','status');this.status.textContent='正在等待 AI 响应…';
  const stopButton=document.createElement('button');stopButton.className='button secondary compact';stopButton.type='button';stopButton.textContent='停止';stopButton.addEventListener('click',()=>this.stop());header.append(this.status,stopButton);
  this.output.className='ai-stream-output';this.output.hidden=true;this.wait.className='ai-stream-wait';this.wait.hidden=true;
  const label=document.createElement('span');label.textContent='暂时没有新内容';const button=document.createElement('button');button.className='button compact';button.type='button';button.textContent='继续等待';button.addEventListener('click',()=>this.answer(true));this.wait.append(label,button);this.card.append(header,this.output,this.wait);
  this.observer={onEvent:event=>this.update(event),onStall:()=>this.ask()};
  this.observerDOM=new MutationObserver(()=>this.mount());this.observerDOM.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});signal.addEventListener('abort',this.onAbort,{once:true});this.mount();
 }
 private onAbort=()=>this.close();
 private mount(){
  if(this.closed||this.signal.aborted)return;const open=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')],host=open.at(-1)??document.body;
  let stack=host.querySelector<HTMLElement>(':scope > .ai-stream-stack');if(!stack){stack=document.createElement('div');stack.className='ai-stream-stack';host.append(stack);}if(this.card.parentElement!==stack){const old=this.card.parentElement;stack.append(this.card);if(old?.classList.contains('ai-stream-stack')&&!old.children.length)old.remove();}
 }
 private update(event:AIStreamEvent){
  if(this.closed||this.signal.aborted)return;this.mount();
  if(event.kind!=='stall'&&this.pending)this.answer(true);
  if(event.kind==='reasoning'){if(!this.text)this.status.textContent='正在思考…';return;}
  if(event.kind==='content'){this.text+=event.delta;if(this.text.length>12000){this.text=this.text.slice(-12000);this.trimmed=true;}this.output.textContent=(this.trimmed?'（仅显示最近内容）\n':'')+displayText(this.text);this.output.hidden=false;this.output.scrollTop=this.output.scrollHeight;this.status.textContent='正在生成…';}
 }
 private ask(){
  if(this.closed||this.signal.aborted)return Promise.resolve(false);this.mount();this.wait.hidden=false;
  return new Promise<boolean>(resolve=>{this.pending=resolve;});
 }
 private answer(value:boolean){this.wait.hidden=true;const resolve=this.pending;this.pending=null;resolve?.(value);}
 close(){if(this.closed)return;this.closed=true;this.observerDOM.disconnect();this.answer(false);this.signal.removeEventListener('abort',this.onAbort);const parent=this.card.parentElement;this.card.remove();if(parent?.classList.contains('ai-stream-stack')&&!parent.children.length)parent.remove();}
}
