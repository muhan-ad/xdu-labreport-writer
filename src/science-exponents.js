/* Editable exponent input with an unfiltered suggestion menu. */
(()=>{
 'use strict';
 let active=null;
 function close(focus=false){if(!active)return;const s=active;active=null;s.trigger.setAttribute('aria-expanded','false');s.panel.remove();if(focus&&s.input.isConnected)s.input.focus({preventScroll:true});}
 function position(){if(!active)return;const {wrap,panel,list}=active,r=wrap.getBoundingClientRect();if(!wrap.isConnected||!wrap.getClientRects().length){close();return;}const width=Math.min(180,innerWidth-20);panel.style.width=width+'px';panel.style.left=Math.max(10,Math.min(r.left,innerWidth-width-10))+'px';const down=innerHeight-r.bottom>=Math.min(panel.offsetHeight,300)||r.top<innerHeight/2;list.style.maxHeight=Math.max(70,Math.min(310,(down?innerHeight-r.bottom:r.top)-30))+'px';panel.style.top=(down?r.bottom+6:Math.max(10,r.top-panel.offsetHeight-6))+'px';}
 function open(wrap,keyboard=false){
  const input=wrap.querySelector('.science-exp'),trigger=wrap.querySelector('.science-exp-trigger');
  if(input.disabled||input.readOnly)return;
  if(active?.wrap===wrap){close();return;}close();
  let suggestions;try{suggestions=JSON.parse(input.dataset.expSuggestions);}catch{suggestions=[-6,-7,-8,-9,-10,-11,-12];}
  const panel=document.createElement('div'),list=document.createElement('div');panel.className='uds-panel science-exponents-panel';panel.setAttribute('popover','manual');list.className='uds-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','指数');panel.append(list);
  for(const value of [...new Set(suggestions)].filter(Number.isInteger)){
   const option=document.createElement('button');option.type='button';option.className='uds-option';option.setAttribute('role','option');option.setAttribute('aria-selected',String(input.value!==''&&Number(input.value)===value));option.textContent=String(value);option.addEventListener('click',()=>{input.value=String(value);close(true);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});list.append(option);
  }
  (wrap.closest('dialog')||document.body).append(panel);active={wrap,input,trigger,panel,list};trigger.setAttribute('aria-expanded','true');panel.showPopover();position();requestAnimationFrame(position);
  if(keyboard)(list.querySelector('[aria-selected="true"]')||list.firstElementChild)?.focus({preventScroll:true});
  panel.addEventListener('keydown',e=>{const options=[...list.children],index=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();options[e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();}});
 }
 document.addEventListener('click',e=>{const trigger=e.target.closest?.('.science-exp-trigger');if(trigger){e.preventDefault();open(trigger.closest('.science-exp-wrap'));}});
 document.addEventListener('keydown',e=>{const wrap=e.target.closest?.('.science-exp-wrap');if(wrap&&((e.altKey&&e.key==='ArrowDown')||e.target.matches('.science-exp-trigger')&&['ArrowDown','ArrowUp'].includes(e.key))){e.preventDefault();open(wrap,true);}else if(e.key==='Escape'&&active){e.preventDefault();close(true);}});
 document.addEventListener('pointerdown',e=>{if(active&&!active.wrap.contains(e.target)&&!active.panel.contains(e.target))close();});
 document.addEventListener('focusin',e=>{if(active&&!active.wrap.contains(e.target)&&!active.panel.contains(e.target))close();});
 document.addEventListener('unified-select-toggle',e=>{if(e.detail.open)close();});
 document.addEventListener('scroll',e=>{if(active&&!active.panel.contains(e.target))position();},true);window.addEventListener('resize',position);
 new MutationObserver(()=>{if(active&&(!active.wrap.isConnected||!active.wrap.getClientRects().length))close();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
})();
