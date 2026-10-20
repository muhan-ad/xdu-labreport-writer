/* Shared presentation adapter. Native select remains the source of form values/events. */
(function(){
 'use strict';
 const states=new Map(),selectProto=HTMLSelectElement.prototype,optionProto=HTMLOptionElement.prototype;
 const descriptors={value:Object.getOwnPropertyDescriptor(selectProto,'value'),selectedIndex:Object.getOwnPropertyDescriptor(selectProto,'selectedIndex')};
 const selectedDescriptor=Object.getOwnPropertyDescriptor(optionProto,'selected');
 let active=null,serial=0;
 const svg=(path,cls='')=>{const node=document.createElementNS('http://www.w3.org/2000/svg','svg');node.setAttribute('viewBox','0 0 24 24');node.setAttribute('aria-hidden','true');node.setAttribute('class',cls);const p=document.createElementNS(node.namespaceURI,'path');p.setAttribute('d',path);node.append(p);return node;};
 function labelFor(select){const explicit=select.getAttribute('aria-label')||select.getAttribute('title');if(explicit)return explicit;const label=select.labels?.[0]||select.parentElement?.querySelector('label');if(!label)return '选择选项';const copy=label.cloneNode(true);copy.querySelectorAll('select,.uds').forEach(node=>node.remove());return copy.textContent.trim()||'选择选项';}
 function notify(state,open){document.dispatchEvent(new CustomEvent('unified-select-toggle',{detail:{select:state.select,open}}));}
 function close(focus=false){if(!active)return;const state=active;active=null;state.button.setAttribute('aria-expanded','false');state.panel.hidePopover();notify(state,false);if(focus&&state.select.isConnected)state.button.focus({preventScroll:true});}
 function position(){if(!active)return;const s=active,r=s.button.getBoundingClientRect(),v=window.visualViewport;
  const width=Math.min(Math.max(r.width,220),Math.max(180,(v?.width||innerWidth)-20));
  const h=s.panel.getBoundingClientRect().height,left=Math.max(10,Math.min(r.left,(v?.width||innerWidth)-width-10));
  const below=innerHeight-r.bottom-18,above=r.top-18,down=below>=Math.min(h,220)||below>=above;
  s.panel.style.width=width+'px';s.panel.style.left=left+'px';
  s.list.style.maxHeight=Math.max(60,Math.min(270,(down?below:above)-20))+'px';
  const height=s.panel.getBoundingClientRect().height;s.panel.style.top=(down?Math.max(8,r.bottom+8):Math.max(8,r.top-height-8))+'px';
 }
 function focusOption(state,index){const choices=[...state.list.querySelectorAll('[role="option"]:not(:disabled)')];if(!choices.length)return;const option=choices[Math.max(0,Math.min(choices.length-1,index))];option.focus({preventScroll:true});const top=option.offsetTop-state.list.offsetTop,bottom=top+option.offsetHeight;if(top<state.list.scrollTop)state.list.scrollTop=top;else if(bottom>state.list.scrollTop+state.list.clientHeight)state.list.scrollTop=bottom-state.list.clientHeight;}
 function optionsKey(select){return JSON.stringify([select.selectedIndex,[...select.options].map(o=>[o.value,o.label,o.disabled,o.hidden,o.parentElement?.disabled,o.parentElement?.hidden])]);}
 function renderOptions(state){state.optionsKey=optionsKey(state.select);const select=state.select;state.list.replaceChildren();
  [...select.options].forEach((option,index)=>{
   if(option.hidden||option.parentElement?.hidden)return;
   const item=document.createElement('button');item.type='button';item.className='uds-option';item.setAttribute('role','option');item.tabIndex=-1;item.setAttribute('aria-selected',String(index===select.selectedIndex));item.disabled=option.disabled||option.parentElement?.tagName==='OPTGROUP'&&option.parentElement.disabled;
   const text=document.createElement('span');text.className='uds-option-label';text.textContent=option.label||option.textContent;item.append(text,svg('m5 12 4 4 10-10','uds-check'));
   item.addEventListener('click',()=>{if(select.disabled||item.disabled)return;select.selectedIndex=index;close(true);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));});state.list.append(item);
  });
  if(!state.list.children.length){const empty=document.createElement('div');empty.className='uds-empty';empty.textContent='没有匹配选项';state.list.append(empty);}
 }
 function sync(state){const select=state.select;
  if(!select.isConnected)return;
  if(!select.classList.contains('uds-native'))select.classList.add('uds-native');
  state.wrapper.hidden=select.hidden||select.style.display==='none';state.button.disabled=select.disabled;
  state.button.setAttribute('aria-label',labelFor(select));const label=select.selectedOptions[0]?.label||select.selectedOptions[0]?.textContent||'请选择';if(state.text.textContent!==label)state.text.textContent=label;
  if(select.id)state.button.dataset.selectId=select.id;
  for(const option of select.options){if(Object.hasOwn(option,'selected'))continue;try{Object.defineProperty(option,'selected',{configurable:true,get(){return selectedDescriptor.get.call(this);},set(value){selectedDescriptor.set.call(this,value);const owner=states.get(this.closest('select'));if(owner)sync(owner);}});}catch{}}
  if(active===state){if(select.disabled||state.wrapper.hidden)close();else{if(state.optionsKey!==optionsKey(select))renderOptions(state);position();}}
 }
 function open(state,keyboard=false){if(state.select.disabled||state.wrapper.hidden)return;if(active===state){close();return;}close();renderOptions(state);
  const host=state.select.closest('dialog')||document.body;host.append(state.panel);active=state;state.button.setAttribute('aria-expanded','true');state.panel.showPopover();position();requestAnimationFrame(position);
  const selected=state.list.querySelector('[aria-selected="true"]');if(selected){state.list.scrollTop=Math.max(0,selected.offsetTop-state.list.offsetTop-state.list.clientHeight/2+selected.offsetHeight/2);}
  if(keyboard){const choices=[...state.list.querySelectorAll('[role="option"]:not(:disabled)')];focusOption(state,Math.max(0,choices.indexOf(selected)));}else state.button.focus({preventScroll:true});notify(state,true);
 }
 function upgrade(select){if(states.has(select)){const state=states.get(select);if(state.wrapper.parentElement!==select.parentElement)select.before(state.wrapper);return;}if(select.multiple||select.size>1)return;
  const wrapper=document.createElement('span');wrapper.className='uds';
  const button=document.createElement('button');button.type='button';button.className='uds-trigger';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const text=document.createElement('span');text.className='uds-value';button.append(text,svg('m6 9 6 6 6-6','uds-chevron'));
  const panel=document.createElement('div');panel.className='uds-panel';panel.setAttribute('popover','manual');
  const list=document.createElement('div');list.className='uds-list';list.id='uds-list-'+(++serial);list.setAttribute('role','listbox');list.setAttribute('aria-label',labelFor(select));button.setAttribute('aria-controls',list.id);panel.append(list);wrapper.append(button);select.before(wrapper);select.classList.add('uds-native');select.tabIndex=-1;
  const state={select,wrapper,button,text,panel,list};states.set(select,state);
  for(const name of ['value','selectedIndex']){const native=descriptors[name];if(Object.hasOwn(select,name))continue;try{Object.defineProperty(select,name,{configurable:true,get(){return native.get.call(this);},set(value){native.set.call(this,value);sync(state);}});}catch{}}
  select.addEventListener('change',()=>sync(state));select.addEventListener('focus',()=>button.focus());
  select.addEventListener('invalid',()=>button.focus());button.addEventListener('click',e=>{e.preventDefault();open(state);});
  button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open(state,true);}});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}const choices=[...list.querySelectorAll('[role="option"]:not(:disabled)')],index=choices.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();focusOption(state,e.key==='Home'?0:e.key==='End'?choices.length-1:index+(e.key==='ArrowDown'?1:-1));}if(e.key==='Tab')setTimeout(()=>{if(active===state&&!panel.contains(document.activeElement))close();},0);});
  sync(state);
 }
 function scan(node){if(node.nodeType!==1&&node!==document)return;if(node.matches?.('select'))upgrade(node);node.querySelectorAll?.('select').forEach(upgrade);}
 function start(){scan(document);new MutationObserver(records=>{
  const refresh=new Set();let removed=false;
  for(const record of records){if(record.type==='childList'){record.addedNodes.forEach(scan);if(record.removedNodes.length)removed=true;}
   const select=record.target instanceof HTMLSelectElement?record.target:record.target.closest?.('select');if(select&&states.has(select))refresh.add(states.get(select));}
  for(const state of refresh)sync(state);
  if(active&&(!active.select.getClientRects().length||getComputedStyle(active.select).visibility==='hidden'))close();
  if(removed)for(const [select,state]of states){if(!select.isConnected){if(active===state)close();state.panel.remove();state.wrapper.remove();states.delete(select);}}
 }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','style','class','selected','value','label','aria-label','open']});
  document.addEventListener('pointerdown',e=>{if(active&&!active.wrapper.contains(e.target)&&!active.panel.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();e.stopPropagation();close(true);}},true);
  document.addEventListener('close',()=>{if(active&&active.select.closest('dialog')&&!active.select.closest('dialog').open)close();},true);
  document.addEventListener('focusin',e=>{if(active&&!active.panel.contains(e.target)&&!active.wrapper.contains(e.target))close();});
  window.addEventListener('resize',position);document.addEventListener('scroll',e=>{if(active&&!active.panel.contains(e.target))position();},true);
  document.addEventListener('reset',()=>setTimeout(()=>{for(const state of states.values())sync(state);},0));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
