"""本实验模板只允许占位符携带实验数值；知识库只提供原理。"""
import math
import re
PLACEHOLDER = re.compile(r"%%DATA:([^:]+):(.+?)%%")
LITERAL = re.compile(r"(?<![\w.])\d+\.\d+|\d+(?:\.\d+)?\s*(?:%|％|MΩ|兆欧|μF|微法|μC|微库|秒|s\b|伏|V\b)")

def validate_text(text, data):
    for m in PLACEHOLDER.finditer(text):
        key, fmt = m.groups()
        v = data.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError("模板引用未知或无效实验量：" + key)
        if not re.fullmatch(r"%\.(?:[0-9]|1[0-2])[fge]|%[fge]", fmt):
            raise ValueError("实验数值占位符格式无效：" + fmt)
    rest = PLACEHOLDER.sub("", text)
    rest = re.sub(r"\\(?:mathrm|text)\{([^{}]*)\}", r"\1", rest)
    rest = rest.replace("\\ ", " ").replace("\\,", " ")
    fixed_assignment = re.search(r"(?:R|C|K|Q|t)(?:_\{?[A-Za-z0-9]+\}?)?\s*=\s*-?\d+(?:\.\d+)?(?![\d./])(?=\s*(?:$|[，。；,;]|[A-Za-zμ]))", rest)
    # Allow symbolic indices and unit-conversion constants, but no frozen numeric result.
    symbolic = re.sub(r"10\s*\^\s*\{?-6\}?", "", rest)
    symbolic = re.sub(r"(?:\\times|×)\s*100\\?%", "", symbolic)
    symbolic = re.sub(r"[A-Za-z]_\{?\d+\}?|[QtR]\^\{?2\}?|\\sqrt\{3\}", "", symbolic)
    symbolic = re.sub(r"(?<!\d)1(?=\s*/\s*\()|(?<=\\frac\{)1(?=\})", "", symbolic)
    symbolic = re.sub(r"(?m)^\s*\d+\.\s+", "", symbolic)
    if "%%DATA:" in rest or LITERAL.search(rest) or fixed_assignment or re.search(r"\d", symbolic):
        raise ValueError("本实验文本含固定实验数值或无效占位符，请重新生成答案/润色；实验结果必须使用当前数据占位符，不能沿用示例或旧结果。")
