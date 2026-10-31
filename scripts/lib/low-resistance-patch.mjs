export function patchLowResistance(sources) {
 const key='低电阻的测量/generate.py', variantKey='低电阻的测量/variants.json';
 if(sources[key]===undefined)return sources;
 let text=sources[key];
 const marker='# MOBILE_LOW_RESISTANCE_V1';
 if(!text.includes(marker)){
  const swap=(before,after)=>{
   if(text.split(before).length!==2)throw Error('低电阻报告入口已变化：'+before.slice(0,60));
   text=text.replace(before,after);
  };
  swap('    R_x_ua = smartlab_ua(R_x)', '    '+marker+'\n    # Different lengths are not repeated readings of the same resistance.\n    R_x_ua = None');
  swap('    rho_u = math.sqrt(4 * (d_u / d_a) ** 2 + (R_x_ua / R_x_a) ** 2) * rho_a',
       '    rho_u = None  # Full uncertainty needs length, bridge and covariance information.\n    rho_ua = smartlab_ua(rho)  # Descriptive scatter only; lengths may be correlated.');
  swap('        "rho": rho, "rho_a": rho_a, "rho_u": rho_u,',
       '        "rho": rho, "rho_a": rho_a, "rho_u": rho_u, "rho_ua": rho_ua,');
  swap('        "Rx_pm": format_measure(R_x_a, R_x_ua), "uRx_s": format_uncertainty(R_x_ua),',
       '        "Rx_pm": None, "uRx_s": None,');
  swap('        "rho_pm": format_measure(rho_a, rho_u) + r" \\times 10^{-8}",',
       '        "rho_pm": None,  # Old combined uncertainty cannot be justified.');
  swap('    print(f"R_x_a = {r[\'R_x_a\']:.4f} mΩ, R_x_ua = {r[\'R_x_ua\']:.6f} mΩ")\n    print(f"ρ_a = {r[\'rho_a\']:.4f}, ρ_u = {r[\'rho_u\']:.4f}")',
       '    print(f"ρ_a = {r[\'rho_a\']:.4f}, ρ_A = {r[\'rho_ua\']:.4f}（仅分散性）")');
  const label='    doc.add_paragraph("代入数据（以 L = 100 mm 一行为例）：")';
  if(text.split(label).length!==3)throw Error('低电阻代入示例已变化');
  text=text.split(label).join('    doc.add_paragraph("代入第一组数据（L = " + format_number(r["L"][0], sig_figs=5) + " mm）：")');
  swap('+ f"{r[\'R_x\'][0]:.4f}" + r" \\times 100}{4 \\times 100} \\approx "',
       '+ f"{r[\'R_x\'][0]:.4f}" + r" \\times 100}{4 \\times " + format_number(r["L"][0], sig_figs=5) + r"} \\approx "');
  const a=text.indexOf('    doc.add_paragraph("8 个长度点的待测电阻平均值：")');
  const b=text.indexOf('    doc.add_heading("3. 电阻率计算", level=2)',a);
  if(a<0||b<0)throw Error('低电阻逐长度结果段已变化');
  text=text.slice(0,a)+'    doc.add_paragraph("各长度对应不同的待测电阻，不将这些电阻视为同一量的重复测量。")\n\n'+text.slice(b);
  const c=text.indexOf('    doc.add_paragraph("不确定度传递（相对不确定度合成');
  const d=text.indexOf('    # 自定义画图',c);
  if(c<0||d<0)throw Error('低电阻不确定度段已变化');
  const analysis=[
   '    doc.add_paragraph("各长度计算所得电阻率的分散性：")',
   String.raw`    doc.add_math(r"u_A(\rho)=t\,s_\rho/\sqrt{n}\approx " + format_scientific(r["rho_ua"], sig_figs=3) + r"\times 10^{-8}\,\Omega\cdot\mathrm{m}")`,
   '    doc.add_paragraph("该数仅反映各点结果的分散；各长度读数可能相关，长度和电桥仪器误差尚未评定，不能据此给出完整合成不确定度。")',
   '    doc.add_run("电阻率平均值：")',
   String.raw`    doc.add_inline_math(r"\bar\rho = " + format_number(r["rho_a"], sig_figs=5) + r"\times 10^{-8}\,\Omega\cdot\mathrm{m}")`,
   ''
  ].join('\n');
  text=text.slice(0,c)+analysis+text.slice(d);
  const e=text.indexOf('    doc.add_run("测量了 8 个不同长度下的电阻值并计算电阻率。电阻率 ")');
  const f=text.indexOf('    doc.add_paragraph("")',e);
  if(e<0||f<0)throw Error('低电阻结果分析段已变化');
  const conclusion=[
   '    doc.add_run("测量不同长度下的电阻并计算电阻率，平均值为 ")',
   String.raw`    doc.add_inline_math(format_number(r["rho_a"], sig_figs=5) + r" \times 10^{-8}\,\Omega\cdot\mathrm{m}")`,
   '    doc.add_run("。完整不确定度还需结合长度、电桥仪器误差及读数相关性评定。")',
   '', ''
  ].join('\n');
  text=text.slice(0,e)+conclusion+text.slice(f);
 }
 text=text.replace('format_number(r["rho_ua"], sig_figs=3)', 'format_scientific(r["rho_ua"], sig_figs=3)');
 sources[key]=text;
 if(sources[variantKey]!==undefined){
  const variants=JSON.parse(sources[variantKey]);
  const old=String.raw`由测量数据计算得：$R_x = %%DATA:Rx_pm:%s%%\,\mathrm{m}\Omega$；$\rho = %%DATA:rho_pm:%s%%\,\Omega\cdot\mathrm{m}$。`;
  const fixed=String.raw`由各长度测量计算得平均电阻率 $\bar\rho = %%DATA:rho_a:%.5g%%\times 10^{-8}\,\Omega\cdot\mathrm{m}$；完整不确定度尚需进一步评定。`;
  variants['结论']=variants['结论'].map(v=>v===old?fixed:v);
  sources[variantKey]=JSON.stringify(variants,null,2)+'\n';
 }
 return sources;
}
