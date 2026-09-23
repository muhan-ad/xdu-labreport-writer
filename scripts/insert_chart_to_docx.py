# -*- coding: utf-8 -*-
"""将图表图片插入已生成的 docx 报告末尾指定章节。

用法：
    python scripts/insert_chart_to_docx.py ^
        --docx-path "xxx.docx" ^
        --image-path "chart.png" ^
        --section "实验结果与分析"

输出（stdout）：
    {"ok": true, "section": "实验结果与分析", "paragraphs_after": 0}
"""
import argparse
import json
import os
import sys
import tempfile

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, '物理实验/实验脚本'))

from docx import Document
from docx.shared import Cm, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH


# 常见章节标题前缀，用于识别章节边界
_SECTION_PREFIXES = [
    '一、', '二、', '三、', '四、', '五、', '六、', '七、', '八、',
    '1、', '2、', '3、', '4、', '5、',
    '一.', '二.', '三.', '四.', '五.',
    '1.', '2.', '3.', '4.', '5.',
]


def _is_section_header(text, target_section):
    """判断段落是否为指定章节的标题。"""
    stripped = text.strip()
    if not stripped:
        return False
    for prefix in _SECTION_PREFIXES:
        if stripped.startswith(prefix):
            title_text = stripped[len(prefix):].strip()
            if title_text == target_section:
                return True
            # 模糊匹配：目标包含在标题中（如"结果分析"→"思考题和结果分析"）
            if target_section in title_text:
                return True
            break
    # 无前缀匹配或未匹配上，直接对比全文
    return stripped == target_section


def _is_any_section_header(text):
    """判断段落是否为任一章节目录。"""
    stripped = text.strip()
    if not stripped:
        return False
    for prefix in _SECTION_PREFIXES:
        if stripped.startswith(prefix):
            return True
    return False


def insert_chart(docx_path, image_path, section, width_cm=14.0):
    """在 docx 指定章节末尾插入图表图片。

    Args:
        docx_path: docx 文件路径
        image_path: 图片文件路径
        section: 章节名（如"实验结果分析"）
        width_cm: 图片宽度（厘米）

    Returns:
        (paragraphs_after, ok)
    """
    # 章节名别名映射
    _ALIASES = {
        '实验结果与分析': '实验结果分析',
    }
    section = _ALIASES.get(section, section)
    if not os.path.exists(docx_path):
        raise FileNotFoundError(f'docx 不存在: {docx_path}')
    if not os.path.exists(image_path):
        raise FileNotFoundError(f'图片不存在: {image_path}')

    doc = Document(docx_path)
    paragraphs = doc.paragraphs

    # 找到目标章节标题所在的段落索引
    target_idx = -1
    for i, p in enumerate(paragraphs):
        if _is_section_header(p.text, section):
            target_idx = i
            break

    if target_idx == -1:
        # 没找到指定章节，尝试模糊匹配
        for i, p in enumerate(paragraphs):
            if section in p.text.strip():
                target_idx = i
                break

    if target_idx == -1:
        raise ValueError(f'未找到章节 "{section}"')

    # 找到该章节末尾（下一个章节标题前或文档末尾）
    end_idx = len(paragraphs)
    for i in range(target_idx + 1, len(paragraphs)):
        txt = paragraphs[i].text.strip()
        # 跳过空行和图片所在行，继续往后找
        if txt and _is_any_section_header(txt):
            end_idx = i
            break

    # 在末尾位置插入图片段落
    # python-docx 只能通过 add_paragraph 在文档末尾追加
    # 要在指定位置插入，用 Oxml 操作
    target_paragraph = paragraphs[end_idx - 1] if end_idx > target_idx + 1 else paragraphs[target_idx]

    # 在目标段落后插入新段落
    new_p = doc.add_paragraph()
    new_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = new_p.add_run()
    run.add_picture(image_path, width=Cm(width_cm))

    # 把新段落移动到目标位置
    # doc.add_paragraph 加在末尾，需要移到最后一段之前
    body = doc.element.body
    # 新段落现在在 body 末尾，把它挪到正确位置
    new_p_element = new_p._element
    body.remove(new_p_element)

    # 插入到 end_idx 之后（end_idx 是下一节标题的索引）
    insert_before = paragraphs[end_idx]._element if end_idx < len(paragraphs) else None
    if insert_before is not None:
        body.insert(body.index(insert_before), new_p_element)
    else:
        body.append(new_p_element)

    # 保存
    tmp = docx_path + '.~chart.tmp'
    doc.save(tmp)
    os.replace(tmp, docx_path)

    paragraphs_after = end_idx - target_idx - 1
    return paragraphs_after


def main():
    parser = argparse.ArgumentParser(description='将图表插入 docx 指定章节')
    parser.add_argument('--docx-path', required=True, help='docx 文件路径')
    parser.add_argument('--image-path', required=True, help='图表图片路径')
    parser.add_argument('--section', default='实验结果分析', help='目标章节名')
    parser.add_argument('--width-cm', type=float, default=14.0, help='图片宽度（厘米）')
    args = parser.parse_args()

    try:
        paras_after = insert_chart(
            docx_path=args.docx_path,
            image_path=args.image_path,
            section=args.section,
            width_cm=args.width_cm,
        )
        result = {'ok': True, 'section': args.section, 'paragraphs_after': paras_after}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        result = {'ok': False, 'error': str(e)}
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()