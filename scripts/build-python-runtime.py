# -*- coding: utf-8 -*-
"""重建内置 Python 运行时（python-runtime/）。

发布机器上执行一次即可；产物目录 `python-runtime/` 已被 .gitignore 忽略，
打包时经 electron-builder 的 extraResources 释放到安装目录。

做三件事：
  1. 下载 Windows x64 嵌入式 Python 发行版（优先国内镜像，失败回退官方）；
  2. 解开 `_pth` 限制（允许 site-packages）并引导 pip；
  3. 按 requirements-runtime.txt 安装依赖，最后打印实际版本便于与清单核对。

用法：
    python scripts/build-python-runtime.py                 # 默认版本见 PY_VERSION
    python scripts/build-python-runtime.py --python 3.14.7 --mirror npmmirror
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, 'python-runtime')
REQUIREMENTS = os.path.join(ROOT, 'requirements-runtime.txt')
DEFAULT_VERSION = '3.14.7'

MIRRORS = {
    'npmmirror': 'https://registry.npmmirror.com/-/binary/python/{v}/python-{v}-embed-amd64.zip',
    'python.org': 'https://www.python.org/ftp/python/{v}/python-{v}-embed-amd64.zip',
}
GET_PIP = 'https://bootstrap.pypa.io/get-pip.py'


def download(url, dest, desc):
    print('  下载 %s\n    %s' % (desc, url))
    req = urllib.request.Request(url, headers={'User-Agent': 'labreport-writer-build'})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, 'wb') as f:
        shutil.copyfileobj(resp, f)
    print('    -> %s（%.1f MB）' % (dest, os.path.getsize(dest) / 1024 / 1024))


def fetch_embed(version, order):
    zip_path = os.path.join(ROOT, '_python-embed-%s.zip' % version)
    if os.path.exists(zip_path):
        print('  已存在 %s，跳过下载' % os.path.basename(zip_path))
        return zip_path
    errors = []
    for key in order:
        try:
            download(MIRRORS[key].format(v=version), zip_path, 'Python %s embeddable (%s)' % (version, key))
            return zip_path
        except Exception as exc:
            errors.append('%s: %s' % (key, exc))
    raise SystemExit('下载失败：\n  ' + '\n  '.join(errors))


def extract(zip_path):
    if os.path.isdir(TARGET):
        print('  清空旧的 %s' % os.path.relpath(TARGET, ROOT))
        shutil.rmtree(TARGET)
    os.makedirs(TARGET, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(TARGET)
    print('  解压到 %s' % os.path.relpath(TARGET, ROOT))


def enable_site_packages():
    """嵌入式发行版默认关闭 site——放开它并加入 Lib/site-packages，否则 pip 装的包导不进来。"""
    pth = [f for f in os.listdir(TARGET) if f.endswith('._pth')]
    if not pth:
        raise SystemExit('未找到 ._pth 文件，发行版结构与预期不符')
    path = os.path.join(TARGET, pth[0])
    lines = open(path, encoding='utf-8').read().splitlines()
    out = []
    for line in lines:
        if line.strip() in ('#import site', 'import site'):
            out.append('import site')
        elif line.strip() == 'Lib\\site-packages':
            continue
        else:
            out.append(line)
    if not any(l.strip().startswith('import site') for l in out):
        out.append('import site')
    out.append('Lib\\site-packages')
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
    print('  已放开 %s（import site + Lib\\site-packages）' % pth[0])


def run_pip(args, desc):
    exe = os.path.join(TARGET, 'python.exe')
    cmd = [exe, '-m', 'pip'] + args
    print('  %s' % desc)
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print((r.stdout or '')[-800:])
        print((r.stderr or '')[-800:])
        raise SystemExit('pip 执行失败：%s' % ' '.join(args))
    return r.stdout or ''


def bootstrap_pip():
    get_pip = os.path.join(ROOT, '_get-pip.py')
    if not os.path.exists(get_pip):
        download(GET_PIP, get_pip, 'get-pip.py')
    exe = os.path.join(TARGET, 'python.exe')
    print('  引导 pip')
    r = subprocess.run([exe, get_pip, '--no-warn-script-location'], cwd=ROOT,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print((r.stderr or '')[-600:])
        raise SystemExit('pip 引导失败')
    # 国内镜像加速（失败则回退官方源）
    run_pip(['config', 'set', 'global.index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple'], '配置清华镜像源')


def install_requirements():
    run_pip(['install', '-r', REQUIREMENTS, '--no-warn-script-location'], '按 requirements-runtime.txt 安装依赖')


def report():
    exe = os.path.join(TARGET, 'python.exe')
    r = subprocess.run([exe, '-c',
                        'import sys,importlib.metadata as m;print(sys.version.split()[0]);'
                        'print(chr(10).join(sorted("%s==%s"%(d.metadata["Name"],d.version) for d in m.distributions())))'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    print()
    print('== 运行时 python 版本与已装包 ==')
    print('  ' + (r.stdout or '').replace('\n', '\n  ').strip())
    print()
    print('请与 requirements-runtime.txt / docs/python-runtime-inventory.json 核对；')
    print('不一致时更新这两份文件，并重跑 npm run verify。')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--python', default=DEFAULT_VERSION, help='嵌入式 Python 版本（默认 %s）' % DEFAULT_VERSION)
    ap.add_argument('--mirror', default='npmmirror', choices=list(MIRRORS), help='优先使用的下载源')
    args = ap.parse_args()
    order = [args.mirror] + [k for k in MIRRORS if k != args.mirror]

    print('== 重建内置 Python 运行时 ==')
    zip_path = fetch_embed(args.python, order)
    extract(zip_path)
    enable_site_packages()
    bootstrap_pip()
    install_requirements()
    report()
    try:
        os.remove(zip_path)
        os.remove(os.path.join(ROOT, '_get-pip.py'))
    except OSError:
        pass
    print('完成：%s' % os.path.relpath(TARGET, ROOT))


if __name__ == '__main__':
    sys.exit(main())
