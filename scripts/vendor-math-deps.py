# -*- coding: utf-8 -*-
"""把公式转换依赖（latex2mathml / mathml2omml，均为纯 Python、MIT）内置进仓库。

为什么要内置：
- 报告生成改为 python-docx + OMML 后需要这两个包；内置后**不必重建随包分发的
  Python 运行时**，也不需要用户机器上 pip 安装；
- 内置副本随 `物理实验/实验脚本/common/_vendor/` 分发，可被数据包热更新覆盖，
  公式层面的修复不必等应用发版。

为什么需要一处小改动：
- `latex2mathml/__init__.py` 在导入时执行 `metadata.version("latex2mathml")`，
  内置（非 pip 安装）时会抛 PackageNotFoundError，这里补一层容错。

用法（升级依赖时）：pip install -U latex2mathml mathml2omml && python scripts/vendor-math-deps.py
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, '物理实验', '实验脚本', 'common', '_vendor')

PACKAGES = ('latex2mathml', 'mathml2omml')

MIT_NOTICE = """Files in this directory are third-party, vendored unmodified except where noted.

- latex2mathml {v_latex2mathml} — https://github.com/roniemartinez/latex2mathml — MIT License
  Patch: __init__.py 的 `metadata.version(...)`  包了一层 try/except（内置运行时里没有
  分发元数据，否则导入即抛 PackageNotFoundError）。
- mathml2omml {v_mathml2omml} — https://github.com/amedama41/mathml2omml — MIT License

MIT License

Copyright (c) the respective authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


def version_of(name):
    try:
        from importlib import metadata
        return metadata.version(name)
    except Exception:
        return 'unknown'


def copy_package(name):
    mod = __import__(name)
    src = os.path.dirname(os.path.abspath(mod.__file__))
    dst = os.path.join(VENDOR, name)
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    print('  内置 %-16s %s → %s' % (name, version_of(name), os.path.relpath(dst, ROOT)))
    return dst, version_of(name)


def patch_latex2mathml_init(dst):
    init = os.path.join(dst, '__init__.py')
    src = open(init, encoding='utf-8').read()
    if 'PackageNotFoundError' in src:
        print('  latex2mathml/__init__.py 已打过补丁，跳过')
        return
    patched = re.sub(
        r'__version__ = metadata\.version\("latex2mathml"\)',
        'try:\n'
        '    __version__ = metadata.version("latex2mathml")\n'
        'except Exception:                     # 内置（非 pip 安装）时没有分发元数据\n'
        '    __version__ = "vendored"',
        src)
    if patched == src:
        raise SystemExit('补丁未生效：latex2mathml/__init__.py 结构与预期不符')
    open(init, 'w', encoding='utf-8', newline='\n').write(patched)
    print('  已给 latex2mathml/__init__.py 打上版本号容错补丁')


def main():
    os.makedirs(VENDOR, exist_ok=True)
    print('内置公式依赖到', os.path.relpath(VENDOR, ROOT))
    versions = {}
    for name in PACKAGES:
        dst, ver = copy_package(name)
        versions[name] = ver
        if name == 'latex2mathml':
            patch_latex2mathml_init(dst)
    notice = MIT_NOTICE.format(v_latex2mathml=versions.get('latex2mathml', '?'),
                               v_mathml2omml=versions.get('mathml2omml', '?'))
    open(os.path.join(VENDOR, 'README.md'), 'w', encoding='utf-8', newline='\n').write(notice)
    print('  已写出 README.md（版本与许可说明）')
    total = sum(os.path.getsize(os.path.join(r, f))
                for r, _, fs in os.walk(VENDOR) for f in fs)
    print('内置总大小: %.0f KB' % (total / 1024))


if __name__ == '__main__':
    main()
