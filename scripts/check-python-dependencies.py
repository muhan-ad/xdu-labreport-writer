"""Check declared Python dependencies and imports (report generation is Word-free)."""
import ast
import importlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    'numpy': 'numpy', 'matplotlib': 'matplotlib', 'openpyxl': 'openpyxl',
    'docx': 'python-docx', 'latex2mathml': 'latex2mathml',
    'mathml2omml': 'mathml2omml', 'lxml': 'lxml', 'scipy': 'scipy',
    # Pillow：matplotlib 的依赖；绘图相关测试用它造 PNG 夹具
    'PIL': 'pillow',
    # Word 实物验收（tests/word_report_test.py，可选）用；报告生成不需要它，
    # 因此声明在 requirements-optional.txt —— 声明了才不会报 Undeclared import，
    # 不在 required 里则不会强制安装、也不做导入检查。
    'win32com': 'pywin32',
}


def declared(file):
    return {re.split(r'[<>=!~;\s\[]', line.strip())[0].lower()
            for line in file.read_text(encoding='utf-8-sig').splitlines()
            if line.strip() and not line.lstrip().startswith(('#', '-'))}


def main():
    errors = []
    required = declared(ROOT / '物理实验/requirements.txt')
    optional = declared(ROOT / 'requirements-optional.txt')
    files = list((ROOT / '物理实验/实验脚本').rglob('*.py'))
    files += list((ROOT / 'tests').glob('*.py'))
    local = {'common', 'validate_schema', 'docx_omml'}
    for file in files:
        for node in ast.walk(ast.parse(file.read_text(encoding='utf-8-sig'))):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name.split('.')[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                names = [node.module.split('.')[0]]
            for name in names:
                if name in sys.stdlib_module_names or name in local:
                    continue
                if PACKAGES.get(name) not in required | optional:
                    errors.append(f'Undeclared import {name}: {file.relative_to(ROOT)}')
    for module, package in PACKAGES.items():
        if package not in required:
            continue          # 可选依赖（如 pywin32）：只声明，不强制安装
        try:
            importlib.import_module(module)
        except Exception as exc:
            errors.append(f'{package} ({module}): {exc}')
    if errors:
        print('\n'.join(sorted(set(errors))))
        return 1
    print(f'PASS: Python dependency declarations and required imports ({len(files)} files)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
