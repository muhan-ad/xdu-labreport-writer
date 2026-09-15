# -*- coding: utf-8 -*-
"""数据模型 IO —— 方式三：data.json 是数据真相。

generate.py 通过 load_data 读取实验数据（dict），不再读 xlsx 坐标。
"""
import json
import os


def load_data(path):
    """读取 data.json，返回 dict。文件不存在返回空 dict。"""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    schema_path = os.path.join(os.path.dirname(path), "schema.json")
    if os.path.exists(schema_path):
        from .data_validation import validate
        with open(schema_path, encoding="utf-8") as f:
            result = validate(json.load(f), data)
        if not result["ok"]:
            errors = result["missing"] + result["invalid"]
            raise ValueError("实验数据无效：" + "；".join(e["label"] + "：" + e.get("reason", "未填写") for e in errors))
    return data