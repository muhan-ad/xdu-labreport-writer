"""Validate read-back DOCX files from the isolated native queue acceptance run."""
import json
from pathlib import Path
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET

base = Path(sys.argv[1])
result = json.loads((base / 'results.json').read_text(encoding='utf8'))
assert result['allExperiments'] and result['offlineLifecycle']
assert len(result['saved']) == 28
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
rows = []
for saved in result['saved']:
    file = base / (saved['id'] + '.docx')
    with zipfile.ZipFile(file) as archive:
        assert archive.testzip() is None
        document = ET.fromstring(archive.read('word/document.xml'))
        text = ''.join(document.itertext())
        assert '原生队列验收' in text and '001234' in text
        formulas = len(document.findall('.//m:oMath', ns))
        assert formulas == saved['formulas'] and formulas > 0
        relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        images = {r.attrib['Id']: posixpath.normpath(posixpath.join('word', r.attrib['Target']))
                  for r in relationships if r.attrib['Type'].endswith('/image')}
        for node in document.findall('.//a:blip', ns):
            rid = node.attrib.get('{' + ns['r'] + '}embed')
            assert rid in images and archive.read(images[rid]).startswith(b'\x89PNG\r\n\x1a\n')
        assert len(images) == saved['charts']
        rows.append({'id': saved['id'], 'bytes': file.stat().st_size,
                     'formulas': formulas, 'images': len(images)})
output = {'reports': len(rows), 'formulas': sum(r['formulas'] for r in rows),
          'images': sum(r['images'] for r in rows), 'rows': rows,
          'scope': 'Actual native queue files read back from Android; ZIP/XML/OMML/embedded PNG validation, not Word pagination or full scientific validation'}
(base / 'docx-verification.json').write_text(json.dumps(output, indent=2), encoding='utf8')
print(json.dumps({key: output[key] for key in ['reports', 'formulas', 'images']}))
