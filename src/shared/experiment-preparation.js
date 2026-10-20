/* Official experiments.js catalog checked 2026-10-17. Semester variants share a page. */
(function(root){
 const ids=Object.freeze({
  'RLC电路的稳态特性研究实验':1,'三棱镜顶角的测量':2,'刚体转动惯量的测量':3,
  '低电阻的测量':4,'光的偏振特性测量':5,'光的偏振特性测量（第一学期）':5,'光的偏振特性测量（上学期）':5,'光的偏振特性测量（下学期）':5,'光的偏振特性测量（第二学期）':5,
  '光栅光谱的测量':6,'直螺线管磁场分布的测量':7,'电容与高电阻的测量':8,
  '衍射光强分布的测量':9,'声速的测量（空气）':10,'声速的测量（水中）':10,
  '重力加速度的测量':11,'扭摆法测量钢丝切变模量':12,'拉伸法测量钢丝杨氏弹性模量':13,
  '灵敏电流计特性的测量':14,'理想气体状态方程':15,'电子偏转特性的测量':16,
  '电表的改装与校准':17,'薄透镜焦距的测量（凹透镜）':20,'薄透镜焦距的测量（凸透镜）':20,
  '激光波长的测量':21,'劈尖干涉':22,'平凸透镜曲率半径的测量':23,'霍尔效应实验':24,'静电场的模拟':25
 });
 function url(name){const key=typeof name==='string'?name.trim().replace(/\(/g,'（').replace(/\)/g,'）'):null;const id=Object.hasOwn(ids,key)?ids[key]:null;return id?'https://wlsyzx.xidian.edu.cn/expe/experiment.html?id='+id:null;}
 const api=Object.freeze({url,ids});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ExperimentPreparation=api;
})(globalThis);
