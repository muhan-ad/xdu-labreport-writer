# -*- coding: utf-8 -*-
"""自定义画图：把应用侧 AI 生成并绘制好的图片插进报告。

应用在 LAB_JOB_INPUT 的 customPlot 字段传入：

    {"images": [{"path": "<绝对路径>", "caption": "图1 ..."}, ...]}

启用后报告里不再插入内置图，改插这些 AI 生成的图（按顺序对应内置插图位置）。
未启用时 render_custom_plot() 返回 False，调用方照常输出内置图。
"""

import json
import os

from .variants import _job_value

MAX_SLOTS = 8          # 单份报告最多接受的图数
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")


def _safe_image_path(raw):
    """校验 AI 图路径：必须是绝对路径、不含 ..、后缀在白名单内。"""
    p = str(raw or "").strip()
    if not p or not os.path.isabs(p):
        return None
    parts = p.replace("\\", "/").split("/")
    if ".." in parts or os.path.splitext(p)[1].lower() not in IMAGE_SUFFIXES:
        return None
    return p


def get_custom_plot():
    """读取应用传入的自定义图：{"images": [{"path","caption"}]}；无则 None。"""
    raw = _job_value("customPlot", "LAB_CUSTOM_PLOT")
    if not raw:
        return None
    try:
        d = json.loads(raw)
    except Exception:
        return None
    if not isinstance(d, dict):
        return None
    images = []
    for item in (d.get("images") or [])[:MAX_SLOTS]:
        if not isinstance(item, dict):
            continue
        path = _safe_image_path(item.get("path"))
        if not path:
            continue
        images.append({"path": path, "caption": str(item.get("caption") or "").strip()})
    return {"images": images} if images else None


def custom_plot_active():
    """是否启用了自定义画图（启用后内置图一律不插入）。"""
    return get_custom_plot() is not None


def render_custom_plot(doc, index, width_cm=14):
    """按图位序号（1 起）插入自定义图；返回 True 表示调用方应跳过内置图。

    启用后即使该图位没有对应的 AI 图也返回 True —— 内置图不再出现，
    多余的图位留空。图片缺失或损坏时打印警告并跳过，不影响报告生成。
    """
    plot = get_custom_plot()
    if not plot:
        return False
    images = plot["images"]
    if 1 <= index <= len(images):
        item = images[index - 1]
        if not os.path.exists(item["path"]):
            print("[WARNING] 自定义图不存在：%s" % item["path"])
        else:
            try:
                doc.add_image(item["path"], width_cm=width_cm)
            except Exception as exc:                      # 损坏图片不应中断报告
                print("[WARNING] 自定义图插入失败：%s（%s）" % (item["path"], exc))
            else:
                # 图片段此刻仍是"空段"（只有图形、没有文字），docx_report 的空段去重会把
                # 紧接着的段落并进来（图注被挤在图片右侧、或后文贴进图片段）——落一个空格
                # 让它不再算空段，后续内容一律另起一段。
                doc.add_run(" ")
                if item["caption"]:
                    doc.add_paragraph_rich(item["caption"])
    return True
