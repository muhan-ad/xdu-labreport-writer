"""Check actual Android Worker DOCX outputs with synthetic fixtures."""
import hashlib,json,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1];out=Path(sys.argv[1]).resolve();base=(root/'artifacts/verification').resolve()
if base not in out.parents or not out.name.startswith('native-worker-'):
    raise ValueError('Not an isolated native corpus directory')
result=json.loads((out/'results.json').read_text(encoding='utf-8'))
expected=hashlib.sha256((root/'artifacts/report-tests/local-photo.png').read_bytes()).digest()
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
checks=[]
for entry in result['results']:
    with zipfile.ZipFile(out/(entry['id']+'.docx')) as doc:
        if doc.testzip():raise ValueError('Corrupt Word archive: '+entry['name'])
        xml=ET.fromstring(doc.read('word/document.xml'))
        count=len(xml.findall('.//m:oMath',ns))
        assert count==entry['formulaCount'],entry['name']+' formula count mismatch'
        text=''.join(x.text or '' for x in xml.findall('.//w:t',ns)+xml.findall('.//m:t',ns))
        assert '本机隔离验收' in text and '001234' in text,entry['name']+' profile missing'
        media=[doc.read(name) for name in doc.namelist() if name.startswith('word/media/')]
        assert any(hashlib.sha256(item).digest()==expected for item in media),entry['name']+' original photo missing'
        assert len(media)>=1+len(entry['charts']),entry['name']+' chart media missing'
        checks.append({'id':entry['id'],'formulas':count,'media':len(media),'charts':len(entry['charts'])})
assert len(checks)==28,'incomplete corpus'
(out/'document-checks.json').write_text(json.dumps({'version':result['version'],'checked':len(checks),'checks':checks,'scope':'DOCX XML and synthetic image identity; not WPS layout or scientific accuracy'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'checked':len(checks),'formulas':sum(x['formulas'] for x in checks),'charts':sum(x['charts'] for x in checks)}))
