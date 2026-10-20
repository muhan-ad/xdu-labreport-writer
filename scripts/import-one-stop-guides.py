"""Import the three reviewed workbooks into one-stop static content (stdlib only)."""
import argparse
import hashlib
import json
import math
import posixpath
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
CATEGORIES = {
    'recommended': ['张元元', '王兰美', '张欢'],
    'not_recommended': ['胡明玮', '吴兴林', '李林茜', '朱婧晶', '武颖丽', '刘伟', '马红玉', '尹伟科',
                        '丁春颖', '卢芳', '胡荣旭', '姚荣辉', '武光玲', '徐强', '王锋哲', '刘春波'],
    'mixed': ['郝二娟', '张锐', '郭新军', '武福平', '代少玉', '王小芳', '武振华', '曹运华'],
}


def read_sheet(file, name):
    with zipfile.ZipFile(file) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in item.findall('.//s:t', NS))
                       for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        relations = {item.get('Id'): item.get('Target')
                     for item in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS)
        sheet = next((item for item in sheets if item.get('name') == name), None)
        if sheet is None:
            raise ValueError(f'{file.name} 缺少工作表：{name}')
        target = relations[sheet.get(REL_ID)]
        target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
        rows = []
        for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
            values = {}
            for cell in row.findall('s:c', NS):
                column = ''.join(c for c in cell.get('r') if c.isalpha())
                value = cell.find('s:v', NS)
                value = value.text if value is not None else ''
                if cell.get('t') == 's':
                    value = strings[int(value)]
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                values[column] = value or ''
            rows.append(values)
        return rows


def records(rows, headers):
    for index, row in enumerate(rows):
        if all(row.get(column) == label for column, label in headers.items()):
            return rows[index + 1:]
    raise ValueError('未找到预期表头')


def rank(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('排序必须是有效数字')
    return number


def load_content(folder):
    recommendations = []
    rows = records(read_sheet(folder / '实验推荐审核表.xlsx', '实验推荐'),
                   {'A': '排序', 'B': '实验名称', 'F': '实验标识（请保留）'})
    for row in rows:
        if not row.get('F'):
            continue
        if not row.get('B', '').strip():
            raise ValueError('实验名称不能为空')
        review = row.get('C', '')
        if not review.strip() or review.strip() == '原文未提及，待补充。':
            review = '暂无评价'
        recommendations.append((rank(row.get('A', '')), {'id': row['F'], 'name': row['B'], 'review': review}))
    recommendations.sort(key=lambda item: item[0])
    recommendations = [item for _, item in recommendations]
    if len(recommendations) != 28 or len({item['id'] for item in recommendations}) != 28:
        raise ValueError('本次应导入 28 个不同的实验')

    category_by_name = {name: category for category, names in CATEGORIES.items() for name in names}
    teachers, pairs = {}, set()
    rows = records(read_sheet(folder / '官网实验教师评价清单.xlsx', '实验教师评价'),
                   {'A': '实验名称', 'B': '老师', 'C': '评价'})
    for row in rows:
        if not row.get('B', '').strip():
            continue
        name, experiment, review = row['B'], row.get('A', ''), row.get('C', '')
        if name not in category_by_name or not experiment.strip() or not review.strip():
            raise ValueError('教师分类、实验或评价不完整：' + name)
        pair = (name, experiment)
        if pair in pairs:
            raise ValueError('重复的老师与实验对应：' + str(pair))
        pairs.add(pair)
        teacher = teachers.setdefault(name, {'name': name, 'category': category_by_name[name], 'groups': []})
        group = next((item for item in teacher['groups'] if item['review'] == review), None)
        if group is None:
            group = {'experiments': [], 'review': review}
            teacher['groups'].append(group)
        group['experiments'].append(experiment)
    if len(pairs) != 46 or set(teachers) != set(category_by_name):
        raise ValueError('本次应导入 27 位老师、46 组实验对应关系')

    faq = []
    for identifier, title, expected in [('course', '选课问题', 6), ('experiment', '实验问题', 8)]:
        items = []
        rows = records(read_sheet(folder / '常见问题填写表.xlsx', title), {'A': '排序', 'B': '问题', 'C': '答'})
        for row in rows:
            question, answer = row.get('B', ''), row.get('C', '')
            if not question.strip() and not answer.strip():
                continue
            if not question.strip() or not answer.strip() or not row.get('D', '').strip():
                raise ValueError(title + '存在不完整问答或缺少条目标识')
            items.append((rank(row.get('A', '')), {'id': row['D'], 'question': question, 'answer': answer}))
        items.sort(key=lambda item: item[0])
        if len(items) != expected or len({item['id'] for _, item in items}) != expected:
            raise ValueError(title + '条数或标识与本次确认内容不符')
        faq.append({'id': identifier, 'title': title, 'items': [item for _, item in items]})
    return {'recommendations': recommendations, 'teachers': list(teachers.values()), 'faq': faq}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/course-selection/guide-content.js')
    args = parser.parse_args()
    files = [args.folder / name for name in ['实验推荐审核表.xlsx', '官网实验教师评价清单.xlsx', '常见问题填写表.xlsx']]
    before = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
    content = load_content(args.folder)
    serialized = '// Reviewed workbook content; categories are explicitly approved, not inferred at runtime.\nwindow.guideContent = '
    serialized += json.dumps(content, ensure_ascii=False, indent=2) + ';\n'
    if before != {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}:
        raise ValueError('导入过程中源文件发生变化，未写入')
    args.output.write_text(serialized, encoding='utf8')
    print(json.dumps({'experiments': len(content['recommendations']), 'teachers': len(content['teachers']),
                      'categories': dict(Counter(item['category'] for item in content['teachers'])),
                      'pairs': sum(len(group['experiments']) for teacher in content['teachers'] for group in teacher['groups']),
                      'faq': [len(module['items']) for module in content['faq']], 'sourceHashes': before}, ensure_ascii=False))


if __name__ == '__main__':
    main()
