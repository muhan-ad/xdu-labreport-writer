# -*- coding: utf-8 -*-
"""将图表图片插入已生成的 docx 报告末尾指定章节。

运行方式（由主进程以 stdin 注入源码执行，脚本本身不落在磁盘上）：
    python -B -X utf8 - --docx-path "xxx.docx" --image-path "chart.png" \
        --section "实验结果分析" --width-cm 14

输出（stdout）：
    {"ok": true, "section": "实验结果分析", "paragraphs_after": 0}
失败时 JSON 打到 stderr 并以非 0 退出。

注意：不依赖 __file__（stdin 注入下它没有意义），只用到 python-docx。
"""
import argparse
import json
import os
import sys

from docx import Document
from docx.shared import Cm, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn


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


def insert_chart(docx_path, image_path, section, width_cm=14.0, caption=''):
    """在 docx 指定章节末尾插入图表图片（可选图注）。

    Args:
        docx_path: docx 文件路径
        image_path: 图片文件路径
        section: 章节名（如"实验结果分析"）
        width_cm: 图片宽度（厘米）
        caption: 可选图注（图片下方居中一行，宋体 10.5pt）

    Returns:
        paragraphs_after
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

    # 在末尾位置插入图片段落（可带图注）
    # python-docx 只能通过 add_paragraph 在文档末尾追加，要在指定位置插入用 Oxml 操作
    new_p = doc.add_paragraph()
    new_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = new_p.add_run()
    run.add_picture(image_path, width=Cm(width_cm))

    caption_p = None
    text = str(caption or '').strip()
    if text:
        caption_p = doc.add_paragraph()
        caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        c_run = caption_p.add_run(text)
        c_run.font.size = Pt(10.5)
        c_run.font.name = '宋体'
        # 中文字体要同时写 eastAsia，否则 Word 里会回退成默认字体
        rPr = c_run._element.get_or_add_rPr()
        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is None:
            rFonts = rPr.makeelement(qn('w:rFonts'), {})
            rPr.append(rFonts)
        for attr in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
            rFonts.set(qn(attr), '宋体')

    # 把新段落从末尾挪到目标位置（图注紧跟图片之后）
    body = doc.element.body
    new_p_element = new_p._element
    body.remove(new_p_element)
    caption_element = None
    if caption_p is not None:
        caption_element = caption_p._element
        body.remove(caption_element)

    insert_before = paragraphs[end_idx]._element if end_idx < len(paragraphs) else None
    if insert_before is not None:
        at = body.index(insert_before)
        body.insert(at, new_p_element)
        if caption_element is not None:
            body.insert(at + 1, caption_element)
    else:
        body.append(new_p_element)
        if caption_element is not None:
            body.append(caption_element)

    # 保存：写临时文件再原子替换。报告可能正被 Word 打开 —— 那时 os.replace 会
    # PermissionError，清理临时文件后抛出可读的中文提示（与报告生成器的口径一致）。
    tmp = docx_path + '.~chart.tmp'
    try:
        doc.save(tmp)
        os.replace(tmp, docx_path)
    except PermissionError:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError('报告文件正被占用（可能已在 Word 中打开），请关闭后重试')
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise

    paragraphs_after = end_idx - target_idx - 1
    return paragraphs_after


def main():
    parser = argparse.ArgumentParser(description='将图表插入 docx 指定章节')
    parser.add_argument('--docx-path', required=True, help='docx 文件路径')
    parser.add_argument('--image-path', required=True, help='图表图片路径')
    parser.add_argument('--section', default='实验结果分析', help='目标章节名')
    parser.add_argument('--width-cm', type=float, default=14.0, help='图片宽度（厘米）')
    parser.add_argument('--caption', default='', help='可选图注（图片下方居中一行）')
    args = parser.parse_args()

    try:
        paras_after = insert_chart(
            docx_path=args.docx_path,
            image_path=args.image_path,
            section=args.section,
            width_cm=args.width_cm,
            caption=args.caption,
        )
        result = {'ok': True, 'section': args.section, 'paragraphs_after': paras_after,
                  'caption': bool(args.caption)}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        result = {'ok': False, 'error': str(e)}
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
