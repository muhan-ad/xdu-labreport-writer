"""Report-only significant-digit limit. Never mutates measurement/calculation data."""
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_UP
import re

MAX_SIGNIFICANT_DIGITS = 5
_NUMBER = re.compile(r'(?<![A-Za-z0-9_.])(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?(?![\d.])')
_IDENTITY = re.compile(r'https?://\S+|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b')

def limit_numeric_text(text, math_mode=False):
    """Cap displayed numeric literals; preserve units, symbols, URLs and dates.

    Short literals retain their stated precision. Decimal avoids binary-float
    tails and underflow. In math, scientific notation is emitted as LaTeX.
    """
    text = str(text)
    protected = []
    def protect(match):
        protected.append(match.group(0))
        return '\ufff0' + chr(0xE000 + len(protected)-1) + '\ufff1'
    text = _IDENTITY.sub(protect, text)
    def replace(match):
        literal = match.group(0)
        mantissa = re.split('[eE]',literal)[0]
        significant = mantissa.replace('.','').lstrip('0')
        if len(significant) <= MAX_SIGNIFICANT_DIGITS:
            return literal
        try:
            value = Decimal(literal)
            with localcontext() as context:
                context.prec = MAX_SIGNIFICANT_DIGITS
                context.rounding = ROUND_HALF_UP
                rounded = +value
            if rounded.is_zero():
                return '0'
            if rounded.adjusted() >= 5 or rounded.adjusted() < -4 or 'e' in literal.lower():
                coefficient, exponent = format(rounded, 'E').split('E')
                coefficient = coefficient.rstrip('0').rstrip('.') if '.' in coefficient else coefficient
                exponent = int(exponent)
                if math_mode:
                    return coefficient + r'\times 10^{' + str(exponent) + '}'
                return coefficient + 'e' + str(exponent)
            result = format(rounded, 'f')
            return result.rstrip('0').rstrip('.') if '.' in result else result
        except (InvalidOperation, ValueError):
            return literal
    text = _NUMBER.sub(replace, text)
    for i, original in enumerate(protected):
        text = text.replace('\ufff0' + chr(0xE000+i) + '\ufff1', original)
    return text
