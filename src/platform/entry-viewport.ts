import {viewportInsets} from '../domain/entry-tools.ts';

/** Native resize already changes innerHeight. Only compensate any remaining visual gap. */
export function manageEntryViewport(root:HTMLElement){
  const viewport=window.visualViewport;if(!viewport)return;
  const html=document.documentElement;let frame=0;
  function update(){
    frame=0;
    const bounds=viewportInsets(innerHeight,viewport!.height,viewport!.offsetTop,viewport!.scale);
    html.classList.toggle('viewport-managed',!!bounds);
    if(!bounds){html.style.removeProperty('--viewport-bottom');return;}
    html.style.setProperty('--viewport-bottom',`${bounds.bottom}px`);
    html.style.setProperty('--viewport-top',`${bounds.top}px`);
    html.style.setProperty('--viewport-height',`${bounds.height}px`);
    const toolbar=root.querySelector<HTMLElement>('.editor-bottom');
    html.style.setProperty('--entry-toolbar-height',`${toolbar?.getBoundingClientRect().height??80}px`);
    const input=document.activeElement;
    if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement)||input.closest('dialog'))return;
    const rect=input.getBoundingClientRect(),bottom=bounds.top+bounds.height-(toolbar?.getBoundingClientRect().height??0)-12,top=bounds.top+12;
    if(rect.bottom>bottom)window.scrollBy({top:rect.bottom-bottom,behavior:'instant'});
    else if(rect.top<top)window.scrollBy({top:rect.top-top,behavior:'instant'});
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  viewport.addEventListener('resize',schedule);viewport.addEventListener('scroll',schedule);
  window.addEventListener('resize',schedule);root.addEventListener('focusin',schedule);
  // Route changes replace direct children. Avoid observing character-by-character text updates.
  new MutationObserver(schedule).observe(root,{childList:true});
  schedule();
}
