# -*- coding: utf-8 -*-
"""数据模型 IO —— 方式三：data.json 是数据真相。

generate.py 通过 load_data 读取实验数据（dict），不再读 xlsx 坐标。
"""
import json
import os


def load_data(path):
    """读取并校验当前用户 data.json；缺失或无效时停止生成。"""
    if not os.path.exists(path):
        raise ValueError("未找到用户数据文件，请先填写并保存实验数据")
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


def bind_input_parameters(data, namespace, script_dir):
    """绑定实际仪器参数；不允许以示例或教材仪器数值补齐。"""
    import math
    with open(os.path.join(script_dir, "schema.json"), encoding="utf-8") as f:
        schema = json.load(f)
    for group in schema.get("groups", []):
        for field in group.get("fields", []):
            name = field.get("bindConstant")
            if not name:
                continue
            value = data.get(field["key"])
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(field["label"] + "：请填写有限正数")
            namespace[name] = float(value)
