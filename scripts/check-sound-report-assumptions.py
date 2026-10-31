"""Verify the generated offline DOCX paragraphs without touching real reports."""
from pathlib import Path
from zipfile import ZipFile
import re
root=Path(__file__).resolve().parents[1]
label='位相比较法按同相与反相点交替记录计算，相邻记录间隔半个波长；仅记录同相点或仅记录反相点的数据不适用此公式。'
for relative in ('artifacts/report-tests/sound-air-0.86.0/1e6e2e7fb80e.docx','artifacts/report-tests/sound-water-0.86.0/496911c88862.docx'):
    with ZipFile(root/relative) as z:
        xml=z.read('word/document.xml').decode('utf-8')
        text=''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>',xml))
        assert text.count(label)==1,relative
        assert '<m:oMath' in xml,relative
    print(relative,'assumption note present once, editable formulas retained')
