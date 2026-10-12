"""Reject unbound experimental values in AI-imported prose."""
import re

def validate_polish(text):
    rest=re.sub(r'%%DATA:[^:]+:.+?%%','',str(text))
    rest=rest.replace('273.15','')
    rest=re.sub(r'\\(?:mathrm|text)\{([^{}]*)\}',r'\1',rest)
    rest=re.sub(r'\\[ ,]',' ',rest)
    if re.search(r'\d+\.\d+|\d+\s*(?:MΩ|兆欧|μF|微法|μC|微库|mm|nm|cm|m/s|kHz|mA|Ω|欧姆|℃|秒|s\b(?!\})|伏|V\b|A\b|%|％)|(?:测得|结果为|电阻为|电容为|声速为|焦距为)\s*[=:：]?\s*-?\d+',rest):
        raise ValueError('导入文本含固定实验数值，请以当前计算结果占位符重新生成润色')
    return text
