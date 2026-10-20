(() => {
'use strict';
const NAME_GROUPS=[
 ['霍尔效应实验','霍尔效应测量磁场实验'],['直螺线管磁场分布的测量','冲击法测量直螺线管磁场实验'],
 ['理想气体状态方程','理想气体状态方程实验'],['重力加速度的测量','复摆实验'],['刚体转动惯量的测量','三线摆测量转动惯量实验','刚体转动惯量的测量实验'],
 ['光的偏振特性测量（第一学期）','光的偏振特性测量（第二学期）','偏振光的特性测量实验'],
 ['电容与高电阻的测量','电容及高电阻测量实验'],['扭摆法测量钢丝切变模量','扭摆法测量切变模量实验'],
 ['声速的测量（水中）','液体中声速测量实验'],['声速的测量（空气）','空气中声速测量实验'],
 ['衍射光强分布的测量','单缝衍射光强分布实验'],['光栅光谱的测量','光栅衍射实验'],['电子偏转特性的测量','电子束的电磁偏转特性实验'],
 ['低电阻的测量','低电阻的测量实验'],['三棱镜顶角的测量','三棱镜顶角的测量实验'],['激光波长的测量','迈克尔逊干涉仪测激光波长实验'],
 ['劈尖干涉','劈尖干涉实验'],['长度与体积的测量','长度与体积测量实验'],
 ['薄透镜焦距的测量（凸透镜）','薄透镜焦距的测量（凹透镜）','薄透镜焦距测量实验'],
 ['平凸透镜曲率半径的测量','牛顿环实验'],['电表的改装与校准','电表改装与校准实验'],
 ['电子元件伏安特性的测量','电子元件伏安特性测量实验'],['灵敏电流计特性的测量','灵敏电流计特性测量实验'],
 ['静电场的模拟','静电场模拟实验'],['拉伸法测量钢丝杨氏弹性模量','拉伸法测量杨氏弹性模量实验'],['RLC电路的稳态特性研究实验']
];
const nameKey=s=>String(s||'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
const nameAliases=new Map(NAME_GROUPS.flatMap(group=>group.map(name=>[nameKey(name),new Set(group.map(nameKey))])));
function nameMatches(a,b){return nameKey(a)===nameKey(b)||!!nameAliases.get(nameKey(a))?.has(nameKey(b))}

function recommendation(name){const entries=window.guideContent?.recommendations||[];return entries.find(e=>nameKey(e.name)===nameKey(name))||entries.find(e=>nameMatches(e.name,name))||null}
function teacher(name){return (window.guideContent?.teachers||[]).find(t=>t.name===String(name||'').trim())||null}
window.GuideReviews=Object.freeze({nameMatches,recommendation,teacher});
})();
