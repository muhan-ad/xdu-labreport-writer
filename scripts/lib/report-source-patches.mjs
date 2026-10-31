import {patchLowResistance} from './low-resistance-patch.mjs';
// Explicit mobile fixes for verified desktop generator defects. Never edit the desktop tree.
export function patchMobileSources(input){
 const sources={...input},name='刚体转动惯量的测量/generate.py',text=sources[name];
 if(typeof text!=='string'||!text.includes('variants = compose(SCRIPT_DIR, res)'))throw Error('刚体报告脚本已变化，请重新核对移动端适配');
 const old='if not render_custom_quiz(doc, r):',fixed='if not render_custom_quiz(doc, res):';
 if(text.includes(old))sources[name]=text.replace(old,fixed);
 else if(!text.includes(fixed))throw Error('刚体报告思考题入口已变化，请重新核对');
 const torsion='扭摆法测量钢丝切变模量/generate.py';
 if(sources[torsion]!==undefined){
  const before='r"\\frac{0.01}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)',after='r"\\frac{" + format_number(DELTA_TIMER, sig_figs=8) + r"}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)';
  const count=sources[torsion].split(before).length-1;
  if(count===2)sources[torsion]=sources[torsion].replaceAll(before,after);
  else if(count!==0||(sources[torsion].split(after).length-1)!==2)throw Error('扭摆计时限差公式已变化，请重新核对移动端适配');
 }
 const rlc='RLC电路的稳态特性研究实验/generate.py';
 if(sources[rlc]!==undefined){
  const before='f0 = round(1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0, 3)',after='f0 = 1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0';
  if(sources[rlc].includes(before))sources[rlc]=sources[rlc].replace(before,after);
  else if(!sources[rlc].includes(after))throw Error('RLC 理论频率计算已变化，请重新核对移动端适配');
 }
 const solenoid='直螺线管磁场分布的测量/generate.py';
 if(sources[solenoid]!==undefined){
  const before=`    u_RKb_b_list = []
    for i in range(3):
        I0_A_i = i0_ma_list[i] / 1000.0
        # d̄m = (dm1+dm2)/2, 两次独立标尺读数
        # u(d̄m) = u_single / √2
        u_dm_bar_mm = u_dm_single_mm / math.sqrt(2.0)
        # 但 propagate_numeric 需要传入 dm1_cm, dm2_cm 分别的不确定度
        # 对于 d̄m(cm) = (dm1(cm) + dm2(cm)) / 2
        # u(dm_cm) = type_b(0.05cm) / √2  (0.05cm = 0.5mm)
        u_dm_cm = type_b(DELTA_SCALE_MM / 10, "uniform") / math.sqrt(2.0)

        _, u_i = propagate_numeric(_calc_RKb_single, {
            "I0_A": (I0_A_i, u_I0_single_A),
            "dm1_cm": (dm1_cm_list[i], u_dm_cm),
            "dm2_cm": (dm2_cm_list[i], u_dm_cm),
        })`;
  const after=`    # Each input is one ruler reading. The mean's 1/2 derivatives apply only once.
    u_dm_single_cm = u_dm_single_mm / 10.0
    u_dm_cm = u_dm_single_cm / math.sqrt(2.0)  # uncertainty of the two-reading mean
    u_RKb_b_list = []
    for i in range(3):
        I0_A_i = i0_ma_list[i] / 1000.0
        _, u_i = propagate_numeric(_calc_RKb_single, {
            "I0_A": (I0_A_i, u_I0_single_A),
            "dm1_cm": (dm1_cm_list[i], u_dm_single_cm),
            "dm2_cm": (dm2_cm_list[i], u_dm_single_cm),
        })`;
  if(sources[solenoid].includes(before))sources[solenoid]=sources[solenoid].replace(before,after);
  else if(!sources[solenoid].includes(after))throw Error('螺线管标尺不确定度计算已变化，请重新核对移动端适配');
  const anchor='        "ot": _ot_rkb,',expanded=anchor+`
        "u_A_RKb": u_A_RKb, "u_B_RKb": u_B_RKb, "u_RKb": u_RKb,
        "u_B_center": u_B_center, "u_B_center_A": u_B_center_A, "u_B_center_B": u_B_center_B,
        "u_dm_single_cm": u_dm_single_cm, "u_dm_mean_cm": u_dm_center_cm,`;
  if(!sources[solenoid].includes(expanded)){
   if(!sources[solenoid].includes(anchor))throw Error('螺线管计算上下文入口已变化，请重新核对');
   sources[solenoid]=sources[solenoid].replace(anchor,expanded);
  }
 }
 for(const [experiment,label] of [['声速的测量（空气）','3-6-2'],['声速的测量（水中）','水中声速的测量（位相比较法）']]){
  const key=experiment+'/generate.py';if(sources[key]===undefined)continue;
  let text=sources[key];const marker='# MOBILE_SOUND_PHASE_V1';
  if(!text.includes(marker)){
   const replace=(before,after)=>{if(text.split(before).length!==2)throw Error(experiment+'位相法报告入口已变化，请重新核对');text=text.replace(before,after);};
   const water=experiment.includes('水中');
   const signature=water?'def _compute_method(L_values: list[float], f: float, t_celsius: float, v_reference: float) -> dict:':'def _compute_method(L_values: list[float], f: float, t_celsius: float) -> dict:';
   replace(signature,marker+'\n'+signature.replace(') -> dict:',', phase_step: float = 0.5) -> dict:'));
   replace('lam = abs(L_values[i + N_HALF] - L_values[i]) / 3.0','lam = abs(L_values[i + N_HALF] - L_values[i]) / (N_HALF * phase_step)');
   replace('        "L": L_values,','        "phase_step": phase_step,\n        "L": L_values,');
   const original=water?'    r2 = _compute_method(L2, f_khz, t_celsius, data["v_reference"])':'    r2 = _compute_method(L2, f_khz, t_celsius)';
   replace(original,'    phase_step = data.get("phase_step")\n    if isinstance(phase_step, bool) or phase_step not in (0.5, 1.0):\n        raise ValueError("请选择位相法相邻记录点间隔")\n'+original.replace(')',', phase_step=phase_step)'));
   replace('        "lambda2": r2["lambda_bar"],','        "phase_step": phase_step,\n        "lambda2": r2["lambda_bar"],');
   const oldFormula='    doc.add_paragraph(\n        "用逐差法计算波长，将 12 个数据分为前后两组（1~6 和 7~12），"\n        "对应项相减后除以 3："\n    )\n    doc.add_math(r"\\lambda_i = \\frac{1}{3}|L_{i+6} - L_i|")';
   const newFormula='    divisor = 3 if r["phase_step"] == 0.5 else 6\n    doc.add_paragraph(f"用逐差法计算波长，将 12 个数据分为前后两组（1~6 和 7~12），对应项相减后除以 {divisor}：")\n    doc.add_math(rf"\\lambda_i = \\frac{{1}}{{{divisor}}}|L_{{i+6}} - L_i|")';
   replace(oldFormula,newFormula);
   const call=`    _write_method_section(doc, r2, "${label}")`,note='    doc.add_paragraph("位相比较法按同相与反相点交替记录计算，相邻记录间隔半个波长；仅记录同相点或仅记录反相点的数据不适用此公式。")\n';
   if(text.includes(note+call))text=text.replace(note+call,call);
   replace(call,'    doc.add_paragraph("相邻位相记录点：" + ("同相与反相交替（半波长）" if r2["phase_step"] == 0.5 else "相同相位（一个波长）"))\n'+call);
  }
  if(!text.includes('phase_step = data.get("phase_step")')||!(text.includes('divisor = 3 if r["phase_step"] == 0.5 else 6')||text.includes('# MOBILE_SOUND_WATER_LENGTH_V1')))throw Error(experiment+'位相法适配不完整');
  sources[key]=text;
 }
 for(const experiment of ['声速的测量（空气）','声速的测量（水中）']){
  const key=experiment+'/generate.py';if(sources[key]===undefined)continue;
  let text=sources[key];const marker='# MOBILE_SOUND_AVG_ERROR_V1';
  if(!text.includes(marker)){
   const old='        "E_avg": mean([r1["E"], r2["E"]]),';
   const replacement='        '+marker+'\n        "E_avg": abs(mean([r1["v_meas"], r2["v_meas"]]) - r1["v_theory"]) / r1["v_theory"] * 100,';
   if(text.split(old).length!==2)throw Error(experiment+'平均声速误差入口已变化');
   text=text.replace(old,replacement);
   const uncertainty='        "u_v_avg": mean([r1["u_v"], r2["u_v"]]),';
   if(text.split(uncertainty).length!==2)throw Error(experiment+'平均声速不确定度入口已变化');
   text=text.replace(uncertainty,'        "u_v_avg": None,  # 两法相关性未知，不能推定平均值的不确定度');
  }
  sources[key]=text;
 }
 const waterSchema='声速的测量（水中）/schema.json';
 if(sources[waterSchema]!==undefined){
  const schema=JSON.parse(sources[waterSchema]);
  for(const group of schema.groups){
   const f=group.fields.find(x=>x.key==='L1'||x.key==='L2');
   if(!f)continue;
   if(f.type!=='array'||![10,12].includes(f.length))throw Error('水中声速数据结构已变化，请重新核对');
   Object.assign(f,{length:10,variableLength:true,minLength:10,maxLength:12,allowedLengths:[10,12]});
   group.name=group.name.replace('（12 次）','（10 或 12 次）');
  }
  sources[waterSchema]=JSON.stringify(schema,null,2)+'\n';
 }
 const validationKey='common/data_validation.py';
 if(sources[validationKey]!==undefined){
  const before='                elif fld.get("variableLength") and not fld.get("minLength", 3) <= len(v) <= fld.get("maxLength", 100):';
  const extra='                elif fld.get("allowedLengths") and len(v) not in fld["allowedLengths"]:\n                    invalid.append({"key": key, "label": label, "reason": "测量点数不符合要求"})\n';
  if(!sources[validationKey].includes(extra+before)){
   if(sources[validationKey].split(before).length!==2)throw Error('测量数据校验入口已变化');
   sources[validationKey]=sources[validationKey].replace(before,extra+before);
  }
 }
 const waterKey='声速的测量（水中）/generate.py';
 if(sources[waterKey]!==undefined){
  let text=sources[waterKey], marker='# MOBILE_SOUND_WATER_LENGTH_V1';
  if(!text.includes(marker)){
   const replace=(a,b)=>{if(text.split(a).length!==2)throw Error('水中声速报告入口已变化：'+a.slice(0,60));text=text.replace(a,b)};
   const anchor='    # 相邻极大值（同/反相点）间距为半波长，逐差法计算 λ_i';
   replace(anchor,`    ${marker}\n    if len(L_values) not in (10, 12):\n        raise ValueError("水中声速每种方法需填写 10 或 12 个测量点")\n    N_HALF = N_LAMBDA = len(L_values) // 2\n`+anchor);
   const old='    divisor = 3 if r["phase_step"] == 0.5 else 6\n    doc.add_paragraph(f"用逐差法计算波长，将 12 个数据分为前后两组（1~6 和 7~12），对应项相减后除以 {divisor}：")\n    doc.add_math(rf"\\lambda_i = \\frac{{1}}{{{divisor}}}|L_{{i+6}} - L_i|")';
   const next='    N_HALF = N_LAMBDA = len(L) // 2\n    divisor = format(N_HALF * r["phase_step"], "g")\n    doc.add_paragraph(f"用逐差法计算波长，将 {len(L)} 个数据分为前后两组（1~{N_HALF} 和 {N_HALF+1}~{len(L)}），对应项相减后除以 {divisor}：")\n    doc.add_math(rf"\\lambda_i = \\frac{{1}}{{{divisor}}}|L_{{i+{N_HALF}}} - L_i|")';
   replace(old,next);
   replace('    for i in range(12):','    for i in range(len(L)):');
   replace('    doc.add_paragraph("对 6 个逐差波长作 3σ 坏值检验：")','    doc.add_paragraph(f"对 {N_LAMBDA} 个逐差波长作 3σ 坏值检验：")');
  }
  text=text.replace('    divisor = f"{N_HALF * r["phase_step"]:g}"','    divisor = format(N_HALF * r["phase_step"], "g")');
  sources[waterKey]=text;
 }
 return patchLowResistance(sources);
}
