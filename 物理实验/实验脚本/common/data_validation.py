"""Shared schema validation for CLI and report generation."""
import math

def _is_num(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)
            and math.isfinite(v))   # 拒 NaN/Inf


def validate(schema, data):
    missing, invalid = [], []
    if not isinstance(data, dict):
        return {"ok": False, "missing": [], "invalid": [{"key": "", "label": "数据", "reason": "应为对象"}]}
    for group in schema.get("groups", []):
        for fld in group.get("fields", []):
            key = fld.get("key")
            label = fld.get("label", key)
            typ = fld.get("type", "number")
            required = fld.get("required", False)
            v = data.get(key)

            # 必填检查
            if required:
                if v is None:
                    missing.append({"key": key, "label": label})
                    continue
                if typ == "array" and (not isinstance(v, list) or any(x is None for x in v)):
                    missing.append({"key": key, "label": label})
                    continue
                if typ == "matrix":
                    # 固定矩阵不能跳过整行；variableRows 表格才允许未使用的行。
                    if not isinstance(v, list):
                        missing.append({"key": key, "label": label})
                        continue
                    if not fld.get("variableRows"):
                        rows = fld.get("rows")
                        if rows is not None and len(v) != rows:
                            missing.append({"key": key, "label": label,
                                            "reason": f"应完整填写 {rows} 行"})
                            continue
                        labels = fld.get("rowLabels", [])
                        empty = [i for i, row in enumerate(v)
                                 if isinstance(row, list) and any(x is None for x in row)]
                        if empty:
                            for i in empty:
                                row_label = labels[i] if i < len(labels) else f"第 {i + 1} 行"
                                missing.append({"key": key, "label": label,
                                                "reason": f"{row_label}未填写完整"})
                            continue
                    filled = [r for r in v
                              if isinstance(r, list) and any(x is not None for x in r)]
                    half = any(any(x is None for x in r) for r in filled)
                    if fld.get("minFilledRows") is not None and len(filled) < fld["minFilledRows"]:
                        missing.append({"key": key, "label": label,
                                        "reason": f"至少填写 {fld['minFilledRows']} 行"})
                        continue
                    if not filled or half:
                        missing.append({"key": key, "label": label})
                        continue

            if v is None:
                continue

            # 类型 / 长度检查
            if typ in ("number", "science"):
                if not _is_num(v):
                    invalid.append({"key": key, "label": label, "reason": "应为数值"})
            elif typ == "array":
                if not isinstance(v, list):
                    invalid.append({"key": key, "label": label, "reason": "应为数组"})
                elif "length" in fld and len(v) != fld["length"]:
                    invalid.append({"key": key, "label": label,
                                    "reason": f"长度应为 {fld['length']}"})
                elif any(x is not None and not _is_num(x) for x in v):
                    invalid.append({"key": key, "label": label, "reason": "含非数值"})
            elif typ == "matrix":
                if not isinstance(v, list):
                    invalid.append({"key": key, "label": label, "reason": "应为矩阵"})
                else:
                    rows, cols = fld.get("rows"), fld.get("cols")
                    # 多于容器上限始终非法；必填固定矩阵的少行已在上面拦截。
                    if rows is not None and len(v) > rows:
                        invalid.append({"key": key, "label": label,
                                        "reason": f"行数不应超过 {rows}"})
                    elif cols is not None and any(
                            not isinstance(r, list) or len(r) != cols for r in v):
                        invalid.append({"key": key, "label": label,
                                        "reason": f"列数应为 {cols}"})
                    elif any(x is not None and not _is_num(x)
                             for r in v if isinstance(r, list) for x in r):
                        invalid.append({"key": key, "label": label, "reason": "含非数值"})
            # Numeric bounds apply to scalar and every array/matrix member.
            vals = v if isinstance(v, list) else [v]
            vals = [x for row in vals for x in (row if isinstance(row, list) else [row])]
            for x in vals:
                if not _is_num(x):
                    continue
                if "minimum" in fld and x < fld["minimum"] or "exclusiveMinimum" in fld and x <= fld["exclusiveMinimum"] or "maximum" in fld and x > fld["maximum"]:
                    invalid.append({"key": key, "label": label, "reason": "超出允许范围"})
                    break
    return {"ok": (not missing and not invalid), "missing": missing, "invalid": invalid}
