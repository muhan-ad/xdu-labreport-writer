"""第二学期薄透镜焦距测量：凸透镜自准法、凹透镜自准法及物像法。

依据官网 tyzoxmz.pdf 第2、4、5页。原字段 x6/x7 仍保存表2的
X4/X5，concave 每行仍为 [原像屏, 凹透镜, 新像屏]，以兼容旧测量记录。
报告与表单统一使用官网记录表的 X4～X8 编号。
"""
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.data_io import load_data, bind_input_parameters
from common.data_validation import validate
from common.variants import compose, render_custom_quiz
from common.custom_plot import render_custom_plot

DELTA_INSTRUMENT = None


def _equal_precision(values, b_factor=1.0):
    ot = outlier_test(values)
    clean = ot['kept']
    avg = mean(clean)
    ua = type_a(clean)
    ub = b_factor * type_b(DELTA_INSTRUMENT)
    uncertainty = combine(ua, ub)
    return {'bar': avg, 's': std_dev(clean), 'sigma': ot['sigma'],
            'bad': [i for i, _ in ot['bad']], 'n': len(clean), 'clean': clean,
            'ot': ot, 't': t_factor(len(clean)), 'uA': ua, 'uB': ub,
            'u': uncertainty, 'e': uncertainty / abs(avg) * 100}


def _compute(data):
    import json
    with open(os.path.join(SCRIPT_DIR, 'schema.json'), encoding='utf-8') as stream:
        checked = validate(json.load(stream), data)
    if not checked['ok']:
        errors = checked['missing'] + checked['invalid']
        raise ValueError('实验数据无效：' + '；'.join(
            item['label'] + '：' + item.get('reason', '未填写完整') for item in errors))
    bind_input_parameters(data, globals(), SCRIPT_DIR)
    f_auto = [float(v) for v in data['f_auto']]
    if any(v <= 0 for v in f_auto):
        raise ValueError('表1凸透镜焦距必须为正数')
    convex = _equal_precision(f_auto)
    # Keep stored keys unchanged; these are X4 and X5 on the official record sheet.
    x4 = [float(v) for v in data['x6']]
    x5 = [float(v) for v in data['x7']]
    gap = [abs(b-a) for a, b in zip(x4, x5)]
    if any(v == 0 for v in gap):
        raise ValueError('表2凹透镜与像屏位置不能重合')
    # f = -|X5-X4|: two position readings, with independent reading errors.
    ca = _equal_precision(gap, b_factor=math.sqrt(2))
    screen1, lens, screen2 = map(list, zip(*data['concave']))
    screen1 = [float(v) for v in screen1]
    lens = [float(v) for v in lens]
    screen2 = [float(v) for v in screen2]
    u = [a-b for a, b in zip(screen1, lens)]
    v = [a-b for a, b in zip(screen2, lens)]
    if any(not 0 < a < b for a, b in zip(u, v)):
        raise ValueError('表3需满足0 < X₆-X₇ < X₈-X₇，请核对像屏及凹透镜位置')
    if data['u1'] <= 0:
        raise ValueError('凸透镜物距必须为正数')
    focal = [a*b/(a-b) for a, b in zip(u, v)]
    return {
        'f_auto': f_auto, 'convex': convex, 'f_auto_bar': convex['bar'],
        'u_auto': convex['u'], 'e_auto': convex['e'], 'ca': ca,
        'convex_value': format_number(convex['bar'], convex['u']),
        'convex_uncertainty': format_number(convex['u'], convex['u']),
        'concave_value': format_number(ca['bar'], ca['u']),
        'concave_uncertainty': format_number(ca['u'], ca['u']),
        'x6': x4, 'x7': x5, 'u1': float(data['u1']),
        'r_x7': screen1, 'r_x6': lens, 'r_x8': screen2,
        'ca_gap': gap, 'f_ca_abs_bar': ca['bar'], 's_ca': ca['s'],
        'sigma_ca': ca['sigma'], 'ca_bad': ca['bad'], 'n_ca_clean': ca['n'],
        'ca_clean': ca['clean'], 'ca_ot': ca['ot'], 'uA_ca': ca['uA'],
        'uB_ca': ca['uB'], 'u_ca': ca['u'], 'e_ca': ca['e'],
        'u_vals': u, 'v_vals': v, 'f_im_vals': focal,
        'f_im_bar': mean(focal), 's_im': std_dev(focal),
        'diff_ca_im': abs(ca['bar']-abs(mean(focal))),
    }


def _precision_section(doc, result, symbol, negative=False):
    n, avg = result['n'], result['bar']
    doc.add_paragraph(outlier_note(result['ot'], unit=' cm', digits=4))
    doc.add_paragraph('有效测量值的平均值与标准差：')
    doc.add_math(rf'\overline{{{symbol}}}=\frac{{1}}{{{n}}}\sum_{{i=1}}^{{{n}}}{symbol}_i={avg:.5f}\ \mathrm{{cm}}')
    doc.add_math(rf's=\sqrt{{\frac{{\sum_{{i=1}}^{{{n}}}({symbol}_i-\overline{{{symbol}}})^2}}{{{n}-1}}}}={result["s"]:.5f}\ \mathrm{{cm}}')
    doc.add_paragraph('A类标准不确定度：')
    doc.add_paragraph_rich(rf"有效测量次数 $n={n}$，对应 $t={result['t']:g}$。")
    doc.add_math(r"u_A=\frac{ts}{\sqrt{n}}" + rf"={result['uA']:.5f}\ \mathrm{{cm}}")
    doc.add_paragraph('B类标准不确定度：')
    if negative:
        doc.add_paragraph('按两次位置读数误差独立、仪器限差服从均匀分布评定，焦距绝对值为两次位置之差：')
        doc.add_math(r'u_B=\sqrt{\left[u(X_4)\right]^2+\left[u(X_5)\right]^2}')
        doc.add_math(rf'u_B=\sqrt{{2}}\frac{{\Delta_{{\mathrm{{仪}}}}}}{{\sqrt{{3}}}}=\sqrt{{2}}\frac{{{DELTA_INSTRUMENT:g}}}{{\sqrt{{3}}}}={result["uB"]:.5f}\ \mathrm{{cm}}')
    else:
        doc.add_math(rf'u_B=\frac{{\Delta_{{\mathrm{{仪}}}}}}{{\sqrt{{3}}}}=\frac{{{DELTA_INSTRUMENT:g}}}{{\sqrt{{3}}}}={result["uB"]:.5f}\ \mathrm{{cm}}')
    doc.add_paragraph('合成标准不确定度及测量结果：')
    doc.add_math(rf'u_c=\sqrt{{\left(u_A\right)^2+\left(u_B\right)^2}}={result["u"]:.5f}\ \mathrm{{cm}}')
    number, uncertainty = format_number(avg, result['u']), format_number(result['u'], result['u'])
    sign = '-' if negative else ''
    doc.add_math(rf'f={sign}({number}\pm {uncertainty})\ \mathrm{{cm}}')
    doc.add_math(rf'E=\frac{{u_c}}{{|\overline{{f}}|}}\times100\%={format_percent(result["e"])}\%')


def _generate_docx(data, output_path):
    result = _compute(data)
    variants = compose(SCRIPT_DIR, result)
    doc = DocxReportWriter(output_path)
    doc.add_title('薄透镜焦距的测量（第二学期）')
    doc.add_student_info()
    for section in ['实验原理', '实验方法']:
        if section in variants:
            doc.add_heading(section, level=1)
            doc.add_paragraph_rich(variants[section])

    doc.add_heading('一、原始记录数据', level=1)
    doc.add_data_photo('（请在此处粘贴原始数据记录照片。）')
    headers = ['次数 $n$'] + [str(i) for i in range(1, 9)]
    doc.add_heading('表1 自准法测量凸透镜焦距', level=2)
    doc.add_table(headers, [['$f$ / cm'] + [f'{v:.2f}' for v in result['f_auto']]],
                  col_widths=[3.2]+[1.2]*8)
    doc.add_heading('表2 自准法测量凹透镜焦距', level=2)
    doc.add_table(headers, [
        ['凹透镜 $X_4$ / cm']+[f'{v:.2f}' for v in result['x6']],
        ['像屏 $X_5$ / cm']+[f'{v:.2f}' for v in result['x7']],
        [r'$f=-|X_4-X_5|$ / cm']+[f'{-v:.2f}' for v in result['ca_gap']],
    ], col_widths=[3.2]+[1.2]*8)
    doc.add_heading('表3 物像法测量凹透镜焦距', level=2)
    doc.add_paragraph_rich(rf'凸透镜物距 $u_L={result["u1"]:.2f}\ \mathrm{{cm}}$')
    table_headers = ['次数 $n$', '像屏 $X_6$/cm', '凹透镜 $X_7$/cm', '像屏 $X_8$/cm',
                     '物距 $u$/cm', '像距 $v$/cm', '$f$/cm']
    rows = [[str(i+1)]+[f'{result[k][i]:.2f}' for k in
             ['r_x7','r_x6','r_x8','u_vals','v_vals','f_im_vals']] for i in range(3)]
    doc.add_table(table_headers, rows, col_widths=[1.0]+[2.1]*6)
    doc.add_paragraph_rich(r'$u=X_6-X_7,\quad v=X_8-X_7,\quad f=\frac{uv}{u-v}$')

    doc.add_heading('二、数据处理和误差分析', level=1)
    doc.add_heading('1. 自准法测量凸透镜焦距', level=2)
    _precision_section(doc, result['convex'], 'f')
    doc.add_heading('2. 自准法测量凹透镜焦距', level=2)
    doc.add_paragraph_rich(r'逐次计算 $f_i=-|X_{4i}-X_{5i}|$，对焦距绝对值进行等精度测量处理。')
    _precision_section(doc, result['ca'], r'|f|', negative=True)
    doc.add_heading('3. 物像法测量凹透镜焦距', level=2)
    doc.add_paragraph_rich(r'原辅助实像是凹透镜的虚物，取 $u=X_6-X_7>0$、$v=X_8-X_7>0$。带符号的成像关系为：')
    doc.add_math(r'-\frac{1}{u}+\frac{1}{v}=\frac{1}{f},\qquad f=\frac{uv}{u-v}')
    for i in range(3):
        u, v, f = [result[k][i] for k in ['u_vals','v_vals','f_im_vals']]
        doc.add_math(rf'u_{{{i+1}}}={result["r_x7"][i]:.2f}-{result["r_x6"][i]:.2f}={u:.2f}\ \mathrm{{cm}}')
        doc.add_math(rf'v_{{{i+1}}}={result["r_x8"][i]:.2f}-{result["r_x6"][i]:.2f}={v:.2f}\ \mathrm{{cm}}')
        doc.add_math(rf'f_{{{i+1}}}=\frac{{{u:.2f}\times {v:.2f}}}{{{u:.2f}-{v:.2f}}}={f:.4f}\ \mathrm{{cm}}')
    doc.add_paragraph('按实验要求，物像法只计算三次焦距的平均值：')
    doc.add_math(rf'\overline{{f}}=\frac{{f_1+f_2+f_3}}{{3}}={result["f_im_bar"]:.4f}\ \mathrm{{cm}}')
    for slot in range(1, 4):
        render_custom_plot(doc, slot, width_cm=14)
    if '误差分析' in variants:
        doc.add_heading('误差分析', level=1)
        doc.add_paragraph_rich(variants['误差分析'])
    doc.add_heading('三、思考题和结果分析', level=1)
    if not render_custom_quiz(doc, result):
        doc.add_heading('1. 自准法测量凸透镜焦距时，为什么得到倒立等大像？', level=2)
        doc.add_paragraph('物屏位于凸透镜的前焦平面时，出射光近似平行，经平面镜反射后沿返回光路再次通过透镜，成像于物屏所在的焦平面。光路调至同轴等高后，以清晰、倒立、等大作为自准位置的判据，物屏至凸透镜的距离即为焦距。')
        doc.add_heading('2. 自准法测凹透镜时，为什么撤去凹透镜和反射镜后还要测量像屏位置？', level=2)
        doc.add_paragraph_rich(r'保持物屏和凸透镜不动，撤去凹透镜和反射镜后，辅助凸透镜单独形成的实像位置为 $X_5$；原凹透镜位置为 $X_4$。两位置之差的绝对值为待测焦距的绝对值，因此 $f=-|X_4-X_5|$。')
        doc.add_heading('3. 物像法中为什么不能直接用实物的薄透镜公式代入正长度？', level=2)
        doc.add_paragraph_rich(r'辅助凸透镜原来的实像位于凹透镜之后，对凹透镜而言是虚物。将虚物距的正长度记为 $u$，实像距记为 $v$，应使用 $-1/u+1/v=1/f$。本光路中 $0<u<v$，故 $f=uv/(u-v)<0$，与发散透镜一致。')
        doc.add_heading('4. 两种凹透镜测量方法的主要误差来源是什么？', level=2)
        doc.add_paragraph('自准法受清晰成像判定、反射镜和凹透镜的联动、两次位置读数影响；物像法还受辅助实像定位影响，焦距对物距、像距的变化较敏感。同一次凹透镜位置读数同时进入物距和像距，误差分析时不能将这两者简单看作互相独立。')
        doc.add_paragraph(f'本次两种方法所得凹透镜焦距绝对值相差 {result["diff_ca_im"]:.4f} cm。')
    if '结论' in variants:
        doc.add_heading('结论', level=1)
        doc.add_paragraph_rich(variants['结论'])
    doc.save()
    doc.close()


def main():
    data = load_data(os.path.join(SCRIPT_DIR, 'data.json'))
    output = os.path.join(SCRIPT_DIR, '实验报告.docx')
    _generate_docx(data, output)
    print(f'报告已生成: {output}')


if __name__ == '__main__':
    main()
