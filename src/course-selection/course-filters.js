(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CourseRules=api;})(globalThis,()=>{
 'use strict';
 const flags=['hideLab','hideAcademic','recommendExperiment','recommendTeacher','specifyExperiments','specifyTeachers'];
 const defaults=(legacy={})=>({hideLab:!!legacy.hideLab,hideAcademic:!!legacy.hideAcademic,recommendExperiment:false,recommendTeacher:false,specifyExperiments:false,specifyTeachers:false,experiments:[],teachers:[]});
 function normalize(value={},legacy={}){const result=defaults(legacy);for(const key of flags)if(typeof value[key]==='boolean')result[key]=value[key];for(const key of ['experiments','teachers'])result[key]=[...new Set((Array.isArray(value[key])?value[key]:[]).filter(x=>typeof x==='string'&&x.trim()&&x.length<=200).map(x=>x.trim()))].slice(0,1000);return result;}
 const canonical=(name,reviews)=>reviews?.recommendation(name)?.name||String(name||'').trim();
 function knownTeacher(item){const names=[...new Set(String(item.teacher||'').split(/[／、,，]/).map(x=>x.trim()).filter(Boolean))];return names.length===1&&!String(item.metadataWarning||'').includes('多位教师')?names[0]:'';}
 function matches(item,config,reviews){
  const name=canonical(item.name,reviews),teacher=knownTeacher(item);
  if(config.recommendExperiment&&reviews?.recommendation(item.name)?.category!=='recommended')return false;
  if(config.recommendTeacher&&(!teacher||reviews?.teacher(teacher)?.category!=='recommended'))return false;
  if(config.specifyExperiments&&!config.experiments.some(n=>canonical(n,reviews)===name))return false;
  if(config.specifyTeachers&&(!teacher||!config.teachers.includes(teacher)))return false;
  return true;
 }
 function cancelState(item,interval,now=Date.now()){
  const start=interval?Date.parse(interval.date+'T'+interval.start+':00+08:00'):NaN;
  let reason=!Number.isFinite(start)?'实验时间待核实':start<=now?'已开始':start-now<=72*3600000?'距开始不足72小时（含72小时）':!((item.officialCancellable??item.cancellable)===true)?'官网当前不允许取消':'';
  return {allowed:!reason,reason,boundary:Number.isFinite(start)?start-72*3600000:null};
 }
 function catalog(items,reviews){
  const experiments=new Map(),teachers=new Map();let unknown=0;
  for(const item of items){const id=canonical(item.name,reviews),teacher=knownTeacher(item),match=String(item.time||'').match(/星期([一二三四五六日天])(上午|下午|晚上)/),time=match?'周'+match[1].replace('天','日')+match[2]:'时间待核实';
   if(!experiments.has(id))experiments.set(id,{id,name:item.name,pairs:new Map()});const experiment=experiments.get(id),label=teacher||('教师待核实'+(item.teacher?'（'+item.teacher+'）':''));if(!experiment.pairs.has(label))experiment.pairs.set(label,new Set());experiment.pairs.get(label).add(time);
   if(!teacher){unknown++;continue}if(!teachers.has(teacher))teachers.set(teacher,{id:teacher,name:teacher,pairs:new Map()});const entry=teachers.get(teacher);if(!entry.pairs.has(item.name))entry.pairs.set(item.name,new Set());entry.pairs.get(item.name).add(time);
  }
  const list=map=>[...map.values()].map(x=>({...x,pairs:[...x.pairs].map(([name,times])=>({name,times:[...times].sort()}))})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  return {experiments:list(experiments),teachers:list(teachers),unknown};
 }
 return Object.freeze({flags,defaults,normalize,canonical,knownTeacher,matches,cancelState,catalog});
});
