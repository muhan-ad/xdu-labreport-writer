"""Inspect the generated Word math and selected interval in all four test reports."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
p=Path('artifacts/report-tests/sound-phase-modes')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
for exp in ('1e6e2e7fb80e','496911c88862'):
 for mode in ('alternating','same-phase'):
  file=p/(exp+'-'+mode+'.docx')
  with ZipFile(file) as z:root=ET.fromstring(z.read('word/document.xml'))
  pars=root.findall('.//w:p',ns);text=''.join(''.join(n.text or '' for n in x.findall('.//w:t',ns)) for x in pars)
  expected='同相与反相交替（半波长）' if mode=='alternating' else '相同相位（一个波长）'
  assert text.count(expected)==1,(file,expected)
  formulas=[]
  for para in pars:
   parts=[x.text or '' for x in para.findall('.//m:t',ns)]
   if 'λ' in ''.join(parts) and 'i+6' in ''.join(parts):
    fractions=para.findall('.//m:f/m:den',ns)
    if fractions:formulas.append(''.join(n.text or '' for n in fractions[0].findall('.//m:t',ns)))
  assert formulas==['3','3' if mode=='alternating' else '6'],(file,formulas)
  print(file.name,expected,'divisors:',formulas)
