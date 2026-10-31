export const effectIds=['genshin','audio','eruption','bsod','self-destruct','pixelate','mirror','danmaku','cursor-army','formula-storm','fake-progress','click-counter','fake-experiment','runaway-button','audio-scale','window-shake','vanish','not-responding','pigeon'] as const;
export interface EggStats {count:number;last:string;effects:Record<string,number>;}
export const emptyEggStats=():EggStats=>({count:0,last:'',effects:{}});
export function validEggStats(value:unknown):value is EggStats {
 const v=value as EggStats;return !!v&&Number.isSafeInteger(v.count)&&v.count>=0&&v.count<=1000000&&typeof v.last==='string'&&(!v.last||effectIds.includes(v.last as typeof effectIds[number]))&&!!v.effects&&typeof v.effects==='object'&&!Array.isArray(v.effects)&&Object.keys(v.effects).length<=effectIds.length&&Object.entries(v.effects).every(([key,count])=>effectIds.includes(key as typeof effectIds[number])&&Number.isSafeInteger(count)&&count>=0&&count<=1000000);
}
export const effectMaxMs=(id:string)=>id==='runaway-button'?90000:id==='genshin'?26000:id==='self-destruct'?18000:['eruption','pigeon'].includes(id)?14000:['fake-progress','fake-experiment','vanish'].includes(id)?12000:id==='formula-storm'?11000:['danmaku','cursor-army','audio-scale','not-responding'].includes(id)?9000:['pixelate','mirror'].includes(id)?6000:id==='click-counter'?7000:8000;
export const officialEggLink='https://ys.mihoyo.com/';
