# -*- coding: utf-8 -*-
"""图表预览 — 生成实验数据图表并输出 PNG。

在生成完整报告前，供 UI 预览图表效果、调整参数。

运行方式（由主进程以 stdin 注入源码执行，脚本本身不落在磁盘上）：
    python -B -X utf8 - --exp-path "<实验目录>" --x-field L --y-field R_n \
        --chart-type scatter --scripts-root "<实验脚本根>" \
        --output "<userData>/.chart-previews/chart_xxx.png"

参数：
    --exp-path     实验目录（含 data.json）
    --scripts-root 实验脚本根目录（含 common/）；缺省时取 --exp-path 的上一级

输出（stdout）：
    {"ok": true, "path": "<png>", "title": "<标题>"}
返回码 0 成功，非 0 失败（失败时 JSON 打到 stderr）。

注意：本脚本会被主进程用 stdin 注入执行（打包后 app.asar 里的文件不是真实路径，
不能作为 python 入口），因此 **不能依赖 __file__** —— 依赖 common/ 的导入必须
在按 --scripts-root / --exp-path 设好 sys.path 之后再惰性导入。
"""

import argparse
import json
import os
import sys
import tempfile


def _setup_paths(exp_path, scripts_root):
    """把实验脚本根（含 common/）加入 sys.path，返回规范化后的根路径。"""
    root = scripts_root or os.path.dirname(os.path.abspath(exp_path))
    if root and root not in sys.path:
        sys.path.insert(0, root)
    return root


def _detect_arrays(data, exp_path):
    """从 data.json 中找出所有 array 类型的字段及其长度。"""
    arrays = {}
    for key, val in data.items():
        if isinstance(val, list) and len(val) > 1:
            arrays[key] = len(val)
    # 尝试从 schema.json 读 label
    schema_path = os.path.join(exp_path, 'schema.json')
    labels = {}
    if os.path.exists(schema_path):
        with open(schema_path, encoding='utf-8') as f:
            schema = json.load(f)
        for group in schema.get('groups', []):
            for field in group.get('fields', []):
                if field.get('type') == 'array':
                    labels[field['key']] = field.get('label', field['key'])
    return arrays, labels


def generate_chart(exp_path, x_field, y_field, chart_type='scatter',
                   title='', xlabel='', ylabel='', output_path=None, scripts_root=''):
    """生成图表预览图。

    Args:
        exp_path: 实验目录路径（包含 data.json）
        x_field: X 轴字段名
        y_field: Y 轴字段名
        chart_type: scatter / line / fit / bar
        title, xlabel, ylabel: 图表文本
        output_path: 输出 PNG 路径（None 则自动创建临时文件）
        scripts_root: 实验脚本根目录（含 common/），用于 sys.path

    Returns:
        (output_path, title)
    """
    _setup_paths(exp_path, scripts_root)
    from common.plot_utils import plot_xy, plot_fit, plot_bar
    from common.data_io import load_data

    data_path = os.path.join(exp_path, 'data.json')
    if not os.path.exists(data_path):
        raise FileNotFoundError(f'data.json 不存在: {data_path}')

    data = load_data(data_path)

    if x_field not in data or y_field not in data:
        raise ValueError(f'字段不存在: x="{x_field}", y="{y_field}"')

    x_data = data[x_field]
    y_data = data[y_field]

    if not isinstance(x_data, list) or not isinstance(y_data, list):
        raise ValueError('X 和 Y 字段必须是数组类型')

    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix='.png', prefix='chart_')
        os.close(fd)

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)

    # 从 schema 获取字段 label 作为默认轴标签
    _, labels = _detect_arrays(data, exp_path)

    # 将 `_x` 转换为 matplotlib 下标 `$_{x}$`（防止 `R_n` 显示为 `R_n`）
    import re
    def _fix_subscript(text):
        # 匹配字母后跟 _x（如 R_n → $R_{n}$），避免中文等非 ASCII 被卷入
        return re.sub(r'([a-zA-Z])_([a-zA-Z0-9])', r'$\1_{\2}$', text)

    if not xlabel:
        xlabel = _fix_subscript(labels.get(x_field, x_field))
    if not ylabel:
        ylabel = _fix_subscript(labels.get(y_field, y_field))
    if not title:
        title = _fix_subscript(f'{labels.get(y_field, y_field)}–{labels.get(x_field, x_field)}')

    if chart_type == 'fit':
        # 线性拟合
        import numpy as np
        from common.regression import linear_regression
        x_np = np.array(x_data, dtype=float)
        y_np = np.array(y_data, dtype=float)
        result = linear_regression(x_np, y_np)
        plot_fit(x_data, y_data, result.slope, result.intercept,
                 xlabel=xlabel, ylabel=ylabel, title=title,
                 save_path=output_path, r_squared=result.r_squared)
    elif chart_type == 'bar':
        # 柱状图：类别标签用 X 值的字符串
        categories = [f'{v:.4g}' if isinstance(v, (int, float)) else str(v) for v in x_data]
        plot_bar(categories, y_data, xlabel=xlabel, ylabel=ylabel,
                 title=title, save_path=output_path)
    else:
        plot_xy(x_data, y_data, xlabel=xlabel, ylabel=ylabel,
                title=title, save_path=output_path,
                kind=chart_type)  # 'scatter' or 'line'

    return output_path, title


def main():
    parser = argparse.ArgumentParser(description='图表预览生成')
    parser.add_argument('--exp-path', required=True, help='实验目录路径')
    parser.add_argument('--x-field', required=True, help='X 轴字段名')
    parser.add_argument('--y-field', required=True, help='Y 轴字段名')
    parser.add_argument('--chart-type', default='scatter',
                        choices=['scatter', 'line', 'fit', 'bar'],
                        help='图表类型')
    parser.add_argument('--title', default='', help='图表标题')
    parser.add_argument('--xlabel', default='', help='X 轴标签')
    parser.add_argument('--ylabel', default='', help='Y 轴标签')
    parser.add_argument('--output', default='', help='输出 PNG 路径')
    parser.add_argument('--scripts-root', default='', help='实验脚本根目录（含 common/）')
    args = parser.parse_args()

    try:
        out_path, title = generate_chart(
            exp_path=args.exp_path,
            x_field=args.x_field,
            y_field=args.y_field,
            chart_type=args.chart_type,
            title=args.title,
            xlabel=args.xlabel,
            ylabel=args.ylabel,
            output_path=args.output or None,
            scripts_root=args.scripts_root,
        )
        result = {'ok': True, 'path': out_path, 'title': title}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        result = {'ok': False, 'error': str(e)}
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
