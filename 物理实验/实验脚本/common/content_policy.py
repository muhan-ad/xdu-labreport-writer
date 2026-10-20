"""Reject unbound experimental values in AI-imported prose."""
import re


def contains_writing_instructions(text):
    return any(fragment in re.sub(r'\s+', '', str(text)) for fragment in (
        '误差应结合本次数据和仪器说明评定', '按知识库口径',
        '用户填写', '用户提供的', '不能采用示例', '未照抄源文档',
        '不虚构数值上限', '保留所有占位符', '只输出改写后的',
    ))

def inspect_text(text, data=None):
    import math
    text = str(text)
    def replace(m):
        key, fmt = m.groups()
        if not re.fullmatch(r'%(?:\.(?:[0-9]|1[0-2]))?[fgesd]', fmt):
            raise ValueError('实验数值占位符格式无效：' + key)
        if data is not None:
            value = data.get(key)
            finite = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            if key.startswith('_') or key not in data or not (finite or (fmt.endswith('s') and isinstance(value, str))):
                raise ValueError('模板引用未知或无效实验量：' + key)
        return ''
    rest = re.sub(r'%%DATA:([^:]+):(.+?)%%', replace, text)
    if '%%DATA:' in rest:raise ValueError('实验数值占位符格式不完整')
    rest = re.sub(r'\\(?:mathrm|text)\{([^{}]*)\}', r'\1', rest)
    rest = re.sub(r'\\[ ,]', ' ', rest)
    num = r'(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)'
    rules = [
        ('r_mohm', r'(?:\bR\b\s*=|测得(?:的)?(?:高电阻|电阻)(?:为|是|值为)?\s*[=:：]?)\s*'+num+r'\s*(MΩ|兆欧|kΩ|Ω)', {'MΩ':1,'兆欧':1,'kΩ':.001,'Ω':.000001}),
        ('r_0', r'(?:\bR_\{?0\}?\s*=|(?:电阻)?标称值(?:为|是)?\s*[=:：]?)\s*'+num+r'\s*(MΩ|兆欧|kΩ|Ω)?', {'MΩ':1,'兆欧':1,'kΩ':.001,'Ω':.000001}),
        ('c_x_bar', r'(?:\bC_\{?x\}?\s*=|测得(?:的)?电容(?:为|是|值为)?\s*[=:：]?)\s*'+num+r'\s*(μF|微法|nF|F)', {'μF':1,'微法':1,'nF':.001,'F':1000000}),
    ]
    for key,value in (data or {}).items():
        if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',key) and len(key)>2 and key!='r_0' and isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value):
            rules.append((key,r'\b'+key+r'\s*=\s*'+num,{}))
    for key, pattern, units in rules:
        expected = (data or {}).get(key)
        if isinstance(expected, bool) or not isinstance(expected,(int,float)) or not math.isfinite(expected):continue
        for m in re.finditer(pattern, rest):
            clause=re.split(r'[。；;\n]',rest[:m.start()])[-1]
            if re.search(r'例如|示例|假设|假定|参考',clause):continue
            token=m.group(1);unit=m.group(2) if len(m.groups())>1 else None;factor=units.get(unit,1)
            parts=token.lower().split('e');decimals=len(parts[0].split('.')[1]) if '.' in parts[0] else 0
            tolerance=.5*10**(int(parts[1]) if len(parts)>1 else 0)*10**(-decimals)*factor+1e-10*max(1,abs(expected))
            if abs(float(token)*factor-expected)>tolerance:
                raise ValueError('文本中的 '+key+' 与当前计算结果不一致，请核对或使用数据占位符。')
    prose=re.sub(r'\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]', '', rest)
    prose=re.sub(r'(?m)^\s*(?:[（(]?\d+[）).、．])\s*','',prose).replace('273.15','')
    warnings=[]
    if re.search(r'-?\d+(?:\.\d+)?\s*(?:MΩ|兆欧|kΩ|μF|微法|nF|μC|微库|mV|μV|mm|nm|cm|m/s|kHz|mA|Ω|欧姆|℃|秒|s\b|伏|V\b|A\b|%|％)|(?:测得|结果为|标称值|精度|分辨力|误差限)[^，。；\n]{0,16}\d',prose):
        warnings.append({'code':'UNVERIFIED_QUANTITY','message':'文本含未绑定数据占位符的数值，请核对其来源、单位和精度；此提醒不阻止生成。'})
    return {'text':text,'warnings':warnings}


def validate_polish(text, data=None):
    if contains_writing_instructions(text):
        raise ValueError('报告正文包含通用写作指导，请改写为本实验的误差来源分析')
    result=inspect_text(text,data)
    if result['warnings']:
        import sys
        print('AI数值提醒 | UNVERIFIED_QUANTITY | 请核对未绑定数值的来源、单位和精度；不阻止生成。',file=sys.stderr,flush=True)
    return text
