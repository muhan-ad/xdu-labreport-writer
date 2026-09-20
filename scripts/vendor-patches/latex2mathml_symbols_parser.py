import os
import re

_HERE: str = os.path.dirname(os.path.realpath(__file__))
SYMBOLS_FILE: str = os.path.join(_HERE, "unimathsymbols.txt")
# 本地补丁（非上游代码）：应用的数据包扩展名白名单不含 .txt（只有 .py/.json/.md），
# 而数据包对 common/ 是整目录替换 —— 只带 .txt 会在用户端被拒收，只带 .md 又能保证
# 覆盖后仍有符号表。因此随包下发同内容的 .md 副本，这里在 .txt 缺失时回退读它。
# 生成方式：scripts/vendor-math-deps.py 在 vendor 后自动写出 .md 副本。
SYMBOLS_FILE_FALLBACK: str = os.path.join(_HERE, "unimathsymbols.md")


def _symbols_path() -> str:
    """优先用上游的 .txt；数据包分发场景只有 .md 副本，回退到它。"""
    if os.path.exists(SYMBOLS_FILE):
        return SYMBOLS_FILE
    return SYMBOLS_FILE_FALLBACK


def convert_symbol(symbol: str) -> str | None:
    return SYMBOLS.get(symbol, None)


def parse_symbols() -> dict[str, str]:
    _symbols: dict[str, str] = {}
    with open(_symbols_path(), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            columns = line.strip().split("^")
            _unicode = columns[0]
            latex = columns[2]
            unicode_math = columns[3]
            if latex and latex not in _symbols:
                _symbols[latex] = _unicode
            if unicode_math and unicode_math not in _symbols:
                _symbols[unicode_math] = _unicode
            for equivalent in re.findall(r"[=#]\s*(\\[^,^ ]+),?", columns[-1]):
                if equivalent not in _symbols:
                    _symbols[equivalent] = _unicode
    _symbols.update(
        {
            r"\And": _symbols[r"\ampersand"],
            r"\bigcirc": _symbols[r"\lgwhtcircle"],
            r"\Box": _symbols[r"\square"],
            r"\circledS": "024C8",
            r"\degree": "000B0",
            r"\diagdown": "02572",
            r"\diagup": "02571",
            r"\dots": "02026",
            r"\dotsb": _symbols[r"\cdots"],
            r"\dotsc": "02026",
            r"\dotsi": _symbols[r"\cdots"],
            r"\dotsm": _symbols[r"\cdots"],
            r"\dotso": "02026",
            r"\emptyset": "02205",
            r"\gggtr": "022D9",
            r"\gvertneqq": "02269",
            r"\gt": _symbols[r"\greater"],
            r"\ldotp": _symbols[r"\period"],
            r"\llless": _symbols[r"\lll"],
            r"\lt": _symbols[r"\less"],
            r"\lvert": _symbols[r"\vert"],
            r"\lVert": _symbols[r"\Vert"],
            r"\lvertneqq": _symbols[r"\lneqq"],
            r"\ngeqq": _symbols[r"\ngeq"],
            r"\nshortmid": _symbols[r"\nmid"],
            r"\nshortparallel": _symbols[r"\nparallel"],
            r"\nsubseteqq": _symbols[r"\nsubseteq"],
            r"\omicron": _symbols[r"\upomicron"],
            r"\rvert": _symbols[r"\vert"],
            r"\rVert": _symbols[r"\Vert"],
            r"\shortmid": _symbols[r"\mid"],
            r"\smallfrown": _symbols[r"\frown"],
            r"\smallint": "0222B",
            r"\smallsmile": _symbols[r"\smile"],
            r"\surd": _symbols[r"\sqrt"],
            r"\thicksim": "0223C",
            r"\thickapprox": _symbols[r"\approx"],
            r"\varsubsetneqq": _symbols[r"\subsetneqq"],
            r"\varsupsetneq": "0228B",
            r"\varsupsetneqq": _symbols[r"\supsetneqq"],
        }
    )
    return _symbols


SYMBOLS: dict[str, str] = parse_symbols()
