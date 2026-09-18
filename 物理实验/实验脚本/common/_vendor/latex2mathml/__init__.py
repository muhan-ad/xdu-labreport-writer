from importlib import metadata

try:
    __version__ = metadata.version("latex2mathml")
except Exception:                     # 内置（非 pip 安装）时没有分发元数据
    __version__ = "vendored"
