# -*- coding: utf-8 -*-
"""报告内容体检：按实验检查「结果是否给出不确定度（±）」与「计算式是否带数值代入」。

用途：发布前核对 26 个实验的报告内容质量。它**不判断物理对错**（那需要人看），
只把两类常见缺陷量化出来，便于分工核对：

  ① 不确定度呈现：统计 ± 出现次数与 u(...) 提及次数。
     全文无 ± 说明结果没有写成「x = (a ± b) 单位」的形式；
     「u 提及多而 ± 少」说明算出了不确定度但没并到结果里。
  ② 计算过程：统计公式里「纯符号（有等号、无数字）」与「含数字（≥2 个数）」的条数。
     纯符号公式多，说明计算式只给了符号式、没给数值代入过程。

用法：
    python scripts/audit-report-content.py                # 全部实验，打印表格
    python scripts/audit-report-content.py --exp 拉伸法测量钢丝杨氏弹性模量
    python scripts/audit-report-content.py --json out.json
"""
import argparse
import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, '物理实验', '实验脚本')
W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
M_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
STUDENT = {'LAB_STUDENT_NAME': '张三', 'LAB_STUDENT_ID': '2023123456',
           'LAB_STUDENT_CLASS': '物理 2301', 'LAB_STUDENT_DATE': '2026-09-19'}


def list_experiments():
    return sorted(d for d in os.listdir(SCRIPTS)
                  if os.path.isdir(os.path.join(SCRIPTS, d)) and d != 'common'
                  and os.path.exists(os.path.join(SCRIPTS, d, 'generate.py')))


def generate_report(exp):
    """按应用的方式（传变体选择 + 学生信息）生成一份报告，返回 docx 路径。"""
    from lxml import etree  # noqa: F401  (仅为提示依赖)
    d = os.path.join(SCRIPTS, exp)
    vj = json.load(open(os.path.join(d, 'variants.json'), encoding='utf-8'))
    os.environ['LAB_VARIANTS'] = json.dumps(
        {k: 0 for k, v in vj.items() if isinstance(v, list) and k != '思考题'}, ensure_ascii=False)
    os.environ.update(STUDENT)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):          # 实验脚本会打印大量计算过程，这里静音
        spec = importlib.util.spec_from_file_location('genmod_' + str(abs(hash(exp))),
                                                      os.path.join(d, 'generate.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        data = mod.load_data(os.path.join(d, 'data.json'))
        out = os.path.join(d, '_体检.docx')
        if os.path.exists(out):
            os.remove(out)
        mod._generate_docx(data, out)
    return out


def measure(path):
    from lxml import etree
    root = etree.fromstring(zipfile.ZipFile(path).read('word/document.xml'))
    text = ''.join(t.text or '' for t in root.iter() if etree.QName(t).localname == 't')
    maths = []
    for om in root.iter(M_NS + 'oMath'):
        maths.append(''.join(x.text or '' for x in om.iter(M_NS + 't')).replace('\r', ''))
    plusminus = text.count('±') + sum(m.count('±') for m in maths)
    u_re = r'u\s*[（(]'
    u_in_text = len(re.findall(u_re, text)) + len(re.findall('不确定度', text))
    u_in_math = sum(len(re.findall(u_re, m)) for m in maths)
    u_mentions = u_in_text + u_in_math
    symbolic = sum(1 for m in maths if '=' in m and not re.search(r'\d', m))
    numeric = sum(1 for m in maths if len(re.findall(r'\d+\.?\d*', m)) >= 2)
    return {'plusminus': plusminus, 'u_mentions': u_mentions, 'formulas': len(maths),
            'symbolic_only': symbolic, 'with_numbers': numeric}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exp', action='append', help='只体检指定实验（可多次）')
    ap.add_argument('--json', help='把结果写入 JSON 文件')
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    exps = args.exp or list_experiments()
    rows = []
    for exp in exps:
        try:
            path = generate_report(exp)
            stats = measure(path)
            os.remove(path)
            rows.append(dict(exp=exp, **stats))
        except Exception as exc:
            rows.append({'exp': exp, 'error': str(exc)[:120]})

    print('%-26s %4s %8s %5s %8s %8s' % ('实验', '±', 'u/不确定度', '公式', '纯符号', '含数字'))
    print('-' * 68)
    no_pm, weak_pm = [], []
    for r in rows:
        if r.get('error'):
            print('%-26s 生成失败: %s' % (r['exp'][:24], r['error']))
            continue
        flag = ''
        if r['plusminus'] == 0 and r['u_mentions'] > 0:
            flag = '  ← 有不确定度但无 ±'
            no_pm.append(r['exp'])
        elif r['plusminus'] == 0:
            flag = '  ← 全文无 ±'
            no_pm.append(r['exp'])
        elif r['u_mentions'] > 2 * r['plusminus']:
            flag = '  ← ± 明显少于不确定度'
            weak_pm.append(r['exp'])
        print('%-26s %4d %8d %5d %8d %8d%s' % (r['exp'][:24], r['plusminus'], r['u_mentions'],
                                                r['formulas'], r['symbolic_only'],
                                                r['with_numbers'], flag))
    print()
    print('汇总：%d 个实验；结果无 ± 的 %d 个；± 明显偏少的 %d 个；纯符号公式 >5 条的 %d 个'
          % (len(rows), len(no_pm), len(weak_pm),
             sum(1 for r in rows if r.get('symbolic_only', 0) > 5)))
    if no_pm:
        print('  无 ±：' + '、'.join(no_pm))
    if weak_pm:
        print('  ± 偏少：' + '、'.join(weak_pm))
    if args.json:
        json.dump(rows, open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print('已写出 ' + args.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
