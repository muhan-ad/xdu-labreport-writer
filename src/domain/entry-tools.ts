export type EntryEdit = {value:string;start:number;end:number};
/** Edit the draft string without rounding or coercing partially entered numbers. */
export function editNumericToken(value:string,start:number|null,end:number|null,token:'sign'|'exponent-token'):EntryEdit {
  const a=Math.max(0,Math.min(value.length,start??value.length)),b=Math.max(a,Math.min(value.length,end??a));
  if(token==='sign'){
    if(value.startsWith('-'))return {value:value.slice(1),start:Math.max(0,a-1),end:Math.max(0,b-1)};
    if(value.startsWith('+'))return {value:'-'+value.slice(1),start:a,end:b};
    if(value.length>=100)return {value,start:a,end:b};
    return {value:'-'+value,start:a+1,end:b+1};
  }
  const remaining=value.slice(0,a)+value.slice(b),existing=remaining.search(/e/i);
  if(existing>=0){const position=value.search(/e/i)+1;return {value,start:position,end:position};}
  const prefix=value.slice(0,a),insert=/^[+-]?$/.test(prefix)?'1e':'e',next=prefix+insert+value.slice(b);
  return next.length>100?{value,start:a,end:b}:{value:next,start:a+insert.length,end:a+insert.length};
}

export function viewportInsets(layoutHeight:number,visualHeight:number,offsetTop:number,scale:number){
  if(![layoutHeight,visualHeight,offsetTop,scale].every(Number.isFinite)||scale<0.98||scale>1.02||visualHeight<=0)return null;
  return {top:Math.max(0,offsetTop),bottom:Math.max(0,layoutHeight-offsetTop-visualHeight),height:visualHeight};
}
