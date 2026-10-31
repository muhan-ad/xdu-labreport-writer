"""Verify actual generated DOCX, not a mirrored writer implementation."""
import hashlib,json,re,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
catalog=json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments'];rows=[]
def read(path):
    with zipfile.ZipFile(path) as archive:
        xml=ET.fromstring(archive.read('word/document.xml'));images=sorted(hashlib.sha256(archive.read(n)).hexdigest() for n in archive.namelist() if n.startswith('word/media/'))
    return xml,images
def visible(xml):return [node.text or '' for node in xml.iter() if node.tag in ('{'+NS['w']+'}t','{'+NS['m']+'}t')]
def enabled(node):return node is not None and node.get('{'+NS['w']+'}val','true') not in ('false','0','off')
for exp in catalog:
    before,before_images=read(ROOT/'artifacts/verification/report-layout/docx-before'/f"{exp['id']}.docx")
    after,after_images=read(ROOT/'artifacts/report-tests'/f"{exp['id']}.docx")
    assert visible(before)==visible(after),exp['name']+' changed visible text or formula content'
    assert before_images==after_images,exp['name']+' changed chart/image content'
    tables=after.findall('.//w:tbl',NS)
    for table in tables:
        tr=table.findall('./w:tr',NS)
        assert enabled(tr[0].find('w:trPr/w:tblHeader',NS)),exp['name']+' missing repeated header'
        for row in tr:assert enabled(row.find('w:trPr/w:cantSplit',NS)),exp['name']+' row can split'
        for p in tr[0].findall('.//w:p',NS):assert enabled(p.find('w:pPr/w:keepNext',NS)),exp['name']+' orphan table header'
    headings=0;questions=0;quiz=False
    for p in after.findall('./w:body/w:p',NS):
        text=''.join(visible(p));title=re.sub(r'^[一二三四五六七八九十0-9、.（）()\s]+','',text)
        if title in ('思考题','问题讨论','课后思考题'):quiz=True
        elif title in ('实验原理','实验方法','原始数据记录','数据处理','误差分析','结论'):
            quiz=False;assert enabled(p.find('w:pPr/w:keepNext',NS)),exp['name']+' heading can orphan';headings+=1
        if quiz and text.rstrip().endswith(('?','？')) and any(enabled(b) for b in p.findall('.//w:b',NS)):
            assert enabled(p.find('w:pPr/w:keepNext',NS)),exp['name']+' question can orphan';questions+=1
    math=len(after.findall('.//m:oMath',NS));assert math==len(before.findall('.//m:oMath',NS))
    rows.append({'id':exp['id'],'name':exp['name'],'tables':len(tables),'checkedHeadings':headings,'checkedQuestions':questions,'formulas':math,'textUnchanged':True,'imagesUnchanged':True})
result={'documents':len(rows),'tables':sum(r['tables'] for r in rows),'formulas':sum(r['formulas'] for r in rows),'checkedHeadings':sum(r['checkedHeadings'] for r in rows),'checkedQuestions':sum(r['checkedQuestions'] for r in rows),'results':rows}
out=ROOT/'artifacts/verification/report-layout/pagination-results.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='results'}))
