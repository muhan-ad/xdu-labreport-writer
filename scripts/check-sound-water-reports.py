from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
import json
root=Path('artifacts/report-tests/sound-water-length'); jobs=json.loads(Path('artifacts/science-audit/sound-water-length/jobs.json').read_text(encoding='utf-8')); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
for j in jobs:
 with ZipFile(root/(j['id']+'.docx')) as f: xml=E.fromstring(f.read('word/document.xml'))
 found=[]
 for p in xml.findall('.//w:p',ns):
  s=''.join(n.text or '' for n in p.findall('.//m:t',ns))
  if 'λ' in s and ('i+5' in s or 'i+6' in s):
   den=p.find('.//m:f/m:den',ns)
   if den is not None: found.append(('5' if 'i+5' in s else '6',''.join(n.text or '' for n in den.findall('.//m:t',ns))))
 expected=[(str(j['n1']//2),format(j['n1']/4,'g')),(str(j['n2']//2),format(j['n2']/2*(.5 if j['mode']=='alternating' else 1),'g'))]
 assert found==expected,(j['id'],found,expected)
 print(j['id'],found)
