/** Format simple measurement subscripts/superscripts after HTML escaping. */
export function measurementLabel(value: string): string {
 const escaped=String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 return escaped.replace(/([A-Za-z\u0370-\u03ff])((?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+))+)/g,(_,base,suffix:string)=>base+suffix.replace(/([_^])(?:\{([^{}]+)\}|([A-Za-z0-9]+))/g,(_match:string,op:string,a:string,b:string)=>`<${op==='_'?'sub':'sup'}>${a||b}</${op==='_'?'sub':'sup'}>`));
}
