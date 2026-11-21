'use strict';

// A report upload must resolve to exactly one official row across every page.
// No substring/fuzzy matching and no automatic confirmation of school prompts.
const NAME_GROUPS = [
 ['霍尔效应实验','霍尔效应测量磁场实验'],
 ['直螺线管磁场分布的测量','冲击法测量直螺线管磁场实验'],
 ['理想气体状态方程','理想气体状态方程实验'],['重力加速度的测量','复摆实验'],
 ['刚体转动惯量的测量','三线摆测量转动惯量实验','刚体转动惯量的测量实验'],
 ['光的偏振特性测量','光的偏振特性测量（第一学期）','光的偏振特性测量（第二学期）','偏振光的特性测量实验'],
 ['电容与高电阻的测量','电容及高电阻测量实验'],['扭摆法测量钢丝切变模量','扭摆法测量切变模量实验'],
 ['声速的测量（水中）','液体中声速测量实验'],['声速的测量（空气）','空气中声速测量实验'],
 ['衍射光强分布的测量','单缝衍射光强分布实验'],['光栅光谱的测量','光栅衍射实验'],
 ['电子偏转特性的测量','电子束的电磁偏转特性实验'],['低电阻的测量','低电阻的测量实验'],
 ['三棱镜顶角的测量','三棱镜顶角的测量实验'],['激光波长的测量','迈克尔逊干涉仪测激光波长实验'],
 ['劈尖干涉','劈尖干涉实验'],['长度与体积的测量','长度与体积测量实验'],
 ['薄透镜焦距的测量（凸透镜）','薄透镜焦距的测量（凹透镜）','薄透镜焦距测量实验'],
 ['平凸透镜曲率半径的测量','牛顿环实验'],['电表的改装与校准','电表改装与校准实验'],
 ['电子元件伏安特性的测量','电子元件伏安特性测量实验'],['灵敏电流计特性的测量','灵敏电流计特性测量实验'],
 ['静电场的模拟','静电场模拟实验'],['拉伸法测量钢丝杨氏弹性模量','拉伸法测量杨氏弹性模量实验'],
 ['RLC电路的稳态特性研究实验'],
];
const key = name => String(name||'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
function reportNameMatches(experiment, official) {
 const a=key(experiment),b=key(official);
 return !!a && !!b && (a===b || NAME_GROUPS.some(group=>group.some(n=>key(n)===a)&&group.some(n=>key(n)===b)));
}

async function uploadMatchingReport({experiment,state,page,openRow,attach,submit,check=()=>{},progress=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}) {
 const deadline=now()+45000;
 async function ready(expectedPage) {
  for(;;) {
   check();if(now()>deadline)throw Error('报告系统响应超时，请在一站通检查后重试');
   const s=await state();check();
   if(s.ok===false)throw Error(s.error||s.message||'报告系统读取失败');
   if(['manual_login','needs_credentials','login_failed','error'].includes(s.phase))throw Error(s.message||'请先在一站通登录报告系统，再点击上传报告');
   if(s.phase==='ready'&&(expectedPage===undefined||s.page===expectedPage))return s;
   await sleep(100);
  }
 }
 async function move(s,direction) {
  const target=s.page+direction;
  const r=await page(direction);check();if(!r.ok)throw Error(r.error||r.message||'报告列表翻页失败');
  return ready(target);
 }
 let s=await ready();
 if(s.dialog||s.uploadPending)throw Error('请先完成或关闭一站通当前的报告操作');
 const count=s.pages||1;
 if(!Number.isInteger(count)||count<1||count>100)throw Error('报告列表页数异常，请在一站通手动核对');
 while(s.page>1)s=await move(s,-1);
 const matches=[];
 for(let p=1;p<=count;p++) {
  if((s.pages||1)!==count)throw Error('报告列表已变化，请重试');
  progress('正在定位实验报告（第 '+p+' / '+count+' 页）…');
  for(const row of s.rows||[])if(reportNameMatches(experiment,row.name))matches.push({row,page:p});
  if(p<count)s=await move(s,1);
 }
 if(matches.length!==1)throw Error(matches.length?'官网有多条对应实验记录，请在一站通选择具体场次后上传':'官网报告列表未找到当前实验，请核对报告系统账号与实验名称');
 const target=matches[0];
 while(s.page!==target.page)s=await move(s,s.page<target.page?1:-1);
 const row=(s.rows||[]).find(r=>r.key===target.row.key&&r.name===target.row.name);
 if(!row)throw Error('对应实验记录已变化，请重新核对');
 if(row.graded||row.canUpload===false)throw Error(row.graded?'该实验已有成绩，官网不允许上传':'官网当前不允许上传该实验报告');
 progress('正在带入当前实验的报告文件…');
 const opened=await openRow(row.key);check();if(!opened.ok)throw Error(opened.error||opened.message||'上传窗口未能打开');
 s=await state();check();
 if(s.dialog?.type!=='upload')throw Error('官网要求额外确认，请在一站通查看提示后继续');
 const dialogId=s.dialog.id;
 const file=await attach();check();if(!file.ok)throw Error(file.error||file.message||'报告文件未能带入');
 s=await state();check();
 if(s.dialog?.id!==dialogId||s.dialog?.type!=='upload')throw Error('官网上传窗口已变化，请核对后继续');
 progress('正在准备上传确认…');
 // Exactly one submit. An ambiguous outcome must never trigger an automatic retry.
 const result=await submit(dialogId);check();
 if(!result.ok)throw Error(result.error||result.message||'报告提交未完成，请在一站通核对结果');
 if(result.confirmationRequired)return {...result,experiment:row.name};
 return {ok:true,submitted:true,experiment:row.name,message:'上传请求已提交，请查看一站通中的官网返回结果'};
}
module.exports={reportNameMatches,uploadMatchingReport};
