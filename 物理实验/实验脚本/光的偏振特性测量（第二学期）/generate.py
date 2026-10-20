"""第二学期偏振光特性测量：三组光功率和同图极坐标曲线。"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common.data_io import load_data
from common.docx_report import DocxReportWriter
from common.custom_plot import render_custom_plot
from common.variants import compose, render_custom_quiz
from common.polarization import compute, plot, summary


def _compute(data):
    result = compute(data)
    return {'polarization': result, 'summary': summary(result),
            'm0': result['groups'][0]['modulation'],
            'm30': result['groups'][1]['modulation'],
            'm45': result['groups'][2]['modulation']}


def _generate_docx(data, output_path):
    r = _compute(data)  # Finish validation before creating or replacing any report.
    chart_path = os.path.join(os.path.dirname(output_path), '第二学期偏振光极坐标图.png')
    plot(r['polarization'], chart_path)
    variants = compose(SCRIPT_DIR, r)
    doc = DocxReportWriter(output_path)
    doc.add_title('光的偏振特性测量（第二学期）')
    doc.add_student_info()
    for section in ('实验目的', '实验原理', '实验方法'):
        if section in variants:
            doc.add_heading(section)
            doc.add_paragraph_rich(variants[section])
    if data.get('wavelength_nm') is not None or data.get('resolution_mw') is not None:
        doc.add_paragraph('仪器记录：' + '；'.join(
            label + f'{data[key]:.6g} ' + unit
            for key, label, unit in [('wavelength_nm', '光源波长λ=', 'nm'), ('resolution_mw', '光功率计分辨力=', 'mW')]
            if data.get(key) is not None))
    doc.add_heading('一、原始数据记录')
    photo_inserted = doc.add_data_photo('（请在此处粘贴原始数据记录照片。）')
    doc.add_paragraph('θ以初始消光方向为零点，三组使用同一零点。光功率单位为mW。')
    # Avoid duplicating the original record; retain readings if the photo is absent or unreadable.
    if not photo_inserted:
        for start, end in [(0, 12), (12, 25)]:
            doc.add_table(['θ / °', 'α=0° P / mW', 'α=30° P / mW', 'α=45° P / mW'],
                          [[str(i*15), *[f'{v:.6g}' for v in data['power_mw'][i]]] for i in range(start, end)])
    doc.add_heading('二、数据处理')
    doc.add_paragraph('将检偏器角度θ作为极角、光功率P作为极径，三组读数绘于同一极坐标图。'
                      '0°和360°分别保留；平均值、极值及拟合使用0°～345°的24个独立方向，避免重复计入同一方向。')
    doc.add_math(r'P(\theta)=A+B\cos(2\theta)+C\sin(2\theta)')
    doc.add_math(r'M=\frac{\sqrt{B^2+C^2}}{A}')
    doc.add_paragraph('A、B、C由最小二乘法得到，M表示检偏器旋转时光功率的调制度，不能直接当作总偏振度。')
    doc.add_table(['α / °', 'A / mW', 'B / mW', 'C / mW', 'M'],
                  [[str(g['alpha_deg']), *[f'{g[k]:.6g}' for k in ('A', 'B', 'C')], f"{g['modulation']:.4f}"]
                   for g in r['polarization']['groups']])
    doc.add_paragraph(r['summary'])
    doc.add_heading('三、实验结果分析')
    if not render_custom_plot(doc, 1, width_cm=14):
        doc.add_image(chart_path, width_cm=14, caption='图1 三种波片转角下的光功率极坐标曲线')
        doc.add_paragraph('注：虚线由理想四分之一波片模型计算，幅度按本组平均光功率缩放，只用于形状比较，不表示独立测得的入射光功率。')
    for section in ('结果分析', '误差分析', '结论'):
        if section in variants:
            doc.add_heading(section, level=2)
            doc.add_paragraph_rich(variants[section])
    if any(g['negative_fit'] for g in r['polarization']['groups']):
        doc.add_paragraph('部分无约束拟合在个别角度给出负功率，应结合背景、零点和残差检查模型适用性，不能据此作物理光强解释。')
    if os.environ.get('LAB_CUSTOM_QUIZ') or os.environ.get('LAB_JOB_INPUT'):
        # No default first-semester questions; only explicitly supplied questions.
        from common.variants import get_custom_quiz
        if get_custom_quiz():
            doc.add_heading('四、思考题')
            render_custom_quiz(doc, r)
    doc.save()
    doc.close()


def main():
    data = load_data(os.path.join(SCRIPT_DIR, 'data.json'))
    output = os.path.join(SCRIPT_DIR, '光的偏振特性测量（第二学期）实验报告.docx')
    _generate_docx(data, output)
    print('报告已生成: ' + output)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('生成失败：' + str(exc), file=sys.stderr)
        sys.exit(1)
