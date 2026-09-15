# -*- coding: utf-8 -*-
"""schema 校验器（方式三）：检查各实验 data.json 是否符合 schema.json。

替代旧的 check_data.py 启发式校验。校验规则来自 schema 的 type/required/length/rows/cols。

本脚本不接受外部路径参数：遍历项目内固定的 物理实验/实验脚本 目录，
对每个含 schema.json 的实验校验，结果以 JSON 打印到 stdout。

输出：
{
  "<实验名>": {"ok": true, "missing": [{"key","label"}...], "invalid": [{"key","label","reason"}...]}
}

用法：
    python validate_schema.py            # 校验所有已迁移（有 schema.json）的实验
"""
import json
import math
import os

PROJECT_ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(PROJECT_ROOT, "物理实验", "实验脚本")


def _load_json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


import importlib.util
_spec = importlib.util.spec_from_file_location("lab_data_validation", os.path.join(BASE, "common", "data_validation.py"))
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
validate = _module.validate


def main():
    exp_dirs = sorted(
        os.path.join(BASE, d) for d in os.listdir(BASE)
        if os.path.isdir(os.path.join(BASE, d)) and d != "common" and not d.startswith(".")
    )
    results = {}
    for d in exp_dirs:
        schema = _load_json(os.path.join(d, "schema.json"))
        if schema is None:
            continue  # 未迁移（无 schema.json）的实验跳过
        data = _load_json(os.path.join(d, "data.json")) or {}
        results[os.path.basename(d)] = validate(schema, data)
    print(json.dumps(results, ensure_ascii=False, indent=1))
    return 1 if any(not r["ok"] for r in results.values()) else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())