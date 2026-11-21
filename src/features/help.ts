import schoolFaq from '../data/school-faq.json';
export const helpEntries=[
 {group:'guide',title:'生成实验报告',text:'选择实验并填写实际测量数据，保存后打开报告，选择章节组合并生成。支持离线生成；导出后用 Word 或 WPS 检查排版与结果。'},
 {group:'guide',title:'一站通',text:'先连接并认证校园网，再登录学校物理实验系统读取课表。教务、实验报告系统使用各自的登录入口。选退课和报告上传需要最后确认。'},
 {group:'guide',title:'实验预习',text:'在实验页打开预习资料。部分上下学期实验共用同一份资料，不表示缺少资料；资料来源沿用原版实验室二维码映射。'},
 {group:'guide',title:'图片识别与数据录入',text:'先在 AI 服务配置支持图片的识图模型。选择数据照片，识别后逐格核对数值、单位和测点对应关系，再确认录入。识别结果可以修改和增减允许的测点。'},
 {group:'guide',title:'思考题、润色和绘图',text:'在 AI 服务配置问答模型后使用。AI 只依据本实验原理和当前数据，不替你补造实测值。润色前先生成报告；采用或导入后重新生成。绘图先核对预览，再采用图组。'},
 {group:'guide',title:'备份与清除',text:'在实验页的“更多”中导出测量数据备份；该文件不包含原始照片。清除前确认备份范围。卸载应用可能删除本机记录。'},
 {group:'faq',title:'未填写／未填写完整',text:'必填数据缺失，补齐对应单元格；核对空值与数值 0 的区别。'},
 {group:'faq',title:'数组长度错误',text:'数据个数与模板不一致，核对测点数量。多次识图后仍无法恢复时，先备份，再清除当前实验数据并重新录入。'},
 {group:'faq',title:'矩阵维度错误',text:'数据行数或列数不符合要求，按本实验表格调整；不要用空行补齐未知测量值。'},
 {group:'faq',title:'每行测量值须与偏转位置逐点对应',text:'偏转位置数量与各组测量值数量不一致，补齐实际测量点或删除多余末点。'},
 {group:'faq',title:'必须是有限数值',text:'数字栏存在文字、无穷大或无效数值，检查小数点、科学计数写法与单位。'},
 {group:'faq',title:'不能小于／不能大于规定值',text:'数据超出允许范围，检查数值、单位与小数点，不要仅为通过检查而改造测量结果。'},
 {group:'faq',title:'内置实验资源缺失',text:'打开资源完整性检查，查看缺失文件。安装资源不完整时重新安装完整安装包；先备份本机数据。'},
 {group:'faq',title:'未配置 API Key',text:'进入设置中的 AI 服务填写配置。问答模型与图片识别模型分开配置；离线报告生成不要求 API Key。'},
 {group:'faq',title:'网络连接超时',text:'检查网络、服务地址和模型配置后再试；学校网站还需要校园网认证。超时不代表已发送的操作必定失败，先核对官网或反馈状态。'},
 {group:'faq',title:'模型返回无法解析',text:'模型未返回要求的数据格式；先核对所选模型是否支持图片或当前任务，再重新请求，或直接手动录入。'},
 {group:'faq',title:'未生成报告文件',text:'查看页面显示的具体错误，检查测量数据和章节设置。资源异常时运行完整性检查。原始数据保留后再尝试清除与重新录入。'},
 {group:'faq',title:'AI 图表对应的数据已变化',text:'修改数据后重新生成或运行预览并采用图组；也可移除旧图组，再生成报告。'},
 {group:'notice',title:'报告检查',text:'生成报告后一定要自己检查。'},
 {group:'notice',title:'学期内容',text:'部分实验在不同学期可能采用不同内容。如果报告与本次实验内容不一致，请通过意见反馈联系开发者。'},
 {group:'notice',title:'版本与资源',text:'使用前核对应用版本和实验资源。手机版当前为开发预览版，仍有移植与真机验收工作。'},
 {group:'notice',title:'图片标注',text:'某些实验要求图片标注学生信息，有此要求时请在 Word 或 WPS 中编辑图片添加。'},
] as const;
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const tabs = [['guide','使用说明'],['faq','应用报错'],['school','选课与实验'],['notice','必读公告']] as const;
type HelpGroup = typeof tabs[number][0];
const helpSections = Object.fromEntries(tabs.map(([group])=>[
 group,
 group==='school' ? schoolFaq : [{
  title:'',
  items:helpEntries.filter(entry=>entry.group===group).map(entry=>({question:entry.title,answer:entry.text})),
 }],
])) as Record<HelpGroup, {title:string;items:{question:string;answer:string}[]}[]>;
const isHelpGroup=(value:string):value is HelpGroup=>tabs.some(([group])=>group===value);
export class HelpView {
 private host:HTMLElement|null=null;
 private life:AbortController|null=null;
 private group:HelpGroup='guide';
 constructor(private showAnswer:(question:string,answer:string)=>void){}
 leave(){this.life?.abort();this.host=null;}
 mount(host:HTMLElement,group='guide'){
  this.leave();
  this.host=host;
  this.group=isHelpGroup(group)?group:'guide';
  this.life=new AbortController();
  host.innerHTML='<section class="panel"><div class="ai-inline" data-help-tabs></div><div data-help-content></div></section>';
  host.addEventListener('click',event=>{
   const element=event.target;
   if(!(element instanceof Element))return;
   const group=element.closest<HTMLElement>('[data-help-group]')?.dataset.helpGroup;
   if(group&&isHelpGroup(group)){this.group=group;this.render();return;}
   const question=element.closest<HTMLButtonElement>('[data-help-question]')?.dataset.helpQuestion;
   if(question===undefined)return;
   const [groupIndex,itemIndex]=question.split(':').map(Number);
   const item=helpSections[this.group][groupIndex]?.items[itemIndex];
   if(item)this.showAnswer(item.question,item.answer);
  },{signal:this.life.signal});
  this.render();
 }
 private render(){
  if(!this.host)return;
  this.host.querySelector('[data-help-tabs]')!.innerHTML=tabs.map(([group,label])=>`<button class="button ${this.group===group?'':'secondary'} compact" data-help-group="${group}" aria-pressed="${this.group===group}">${label}</button>`).join('');
  const content=this.host.querySelector('[data-help-content]')!;
  content.innerHTML=helpSections[this.group].map((section,groupIndex)=>`<section class="help-card-group">${section.title?`<h3>${esc(section.title)}</h3>`:''}${section.items.map((item,itemIndex)=>`<button type="button" class="help-question" data-help-question="${groupIndex}:${itemIndex}" aria-haspopup="dialog"><span>${esc(item.question)}</span><span aria-hidden="true">›</span></button>`).join('')}</section>`).join('');
 }
}
