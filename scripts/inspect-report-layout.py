"""Read-only Word-PDF/OOXML screening. Flags require visual review, not automatic rejection."""
import argparse,json,math,re,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
import pdfplumber
from pdf2image import convert_from_path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
parser=argparse.ArgumentParser();parser.add_argument('--directory',default='artifacts/verification/report-layout/word-before');parser.add_argument('--source-directory',default='artifacts/report-tests');parser.add_argument('--no-contact',action='store_true');args=parser.parse_args()
directory=ROOT/args.directory;rows=json.loads((directory/'word-results.json').read_text(encoding='utf-8-sig'));results=[]
for row in rows:
    if row['status']!='rendered':continue
    with zipfile.ZipFile(ROOT/args.source_directory/f"{row['id']}.docx") as archive:
        xml=ET.fromstring(archive.read('word/document.xml'));section=xml.find('.//w:sectPr',NS);margin=section.find('w:pgMar',NS);size=section.find('w:pgSz',NS)
        attr=lambda e,key:int(e.attrib['{'+NS['w']+'}'+key])/20
        width=attr(size,'w');left,right=attr(margin,'left'),attr(margin,'right');usable=width-left-right
        math_count=len(xml.findall('.//m:oMath',NS));table_flags=[]
        for i,table in enumerate(xml.findall('.//w:tbl',NS)):
            columns=table.findall('./w:tblGrid/w:gridCol',NS);grid=sum(attr(c,'w') for c in columns)
            if grid>usable+2:table_flags.append({'table':i,'gridWidth':grid,'usable':usable})
    pages=[]
    with pdfplumber.open(directory/f"{row['id']}.pdf") as pdf:
        for index,page in enumerate(pdf.pages):
            chars=[c for c in page.chars if c.get('text','').strip()]
            outside=[c for c in chars if c['x0']<-.5 or c['x1']>page.width+.5 or c['top']<-.5 or c['bottom']>page.height+.5]
            outside_body_candidates=[c for c in chars if c['x0']<left-3 or c['x1']>page.width-right+3]
            hanging=[c for c in outside_body_candidates if c['text'] in '。，、：；？！）】》”’' and c['x0']>=left-3 and c['x1']<=page.width-right+max(12,c['size'])+3]
            outside_body=[c for c in outside_body_candidates if c not in hanging]
            text=page.extract_text() or '';pdf_images=[i for i in page.images if i['x0']<-.5 or i['x1']>page.width+.5 or i['top']<-.5 or i['bottom']>page.height+.5]
            pages.append({'page':index+1,'characters':len(chars),'outsidePageCharacters':len(outside),'outsideBodyCharacters':len(outside_body),'outsidePageSample':''.join(c['text'] for c in outside)[:150],'outsideBodySample':''.join(c['text'] for c in outside_body)[:150],'outsidePageImages':len(pdf_images),'textBottom':max((c['bottom'] for c in chars),default=0),'replacementGlyphs':text.count('\ufffd'),'literalLatex':bool(re.search(r'\\(?:frac|sqrt|begin|cdot|alpha)\b',text)),'textPreview':text[:100]})
        pages_count=len(pdf.pages)
    # A contact sheet gives a complete page overview; flagged pages get full-size inspection separately.
    images=[] if args.no_contact else convert_from_path(str(directory/f"{row['id']}.pdf"),dpi=45,fmt='png',thread_count=1)
    cols=2;thumb_w=400;thumb_h=590;sheet=Image.new('RGB',(cols*thumb_w,max(1,math.ceil(len(images)/cols))*thumb_h),'#dddddd');draw=ImageDraw.Draw(sheet)
    for i,image in enumerate(images):
        image.thumbnail((380,555));x=(i%cols)*thumb_w+10;y=(i//cols)*thumb_h+25;sheet.paste(image,(x,y));draw.text((x,y-18),f'page {i+1}',fill='black')
    if images:sheet.save(directory/f"{row['id']}-contact.png")
    results.append({'id':row['id'],'name':row['name'],'wordPages':row['pages'],'pdfPages':pages_count,'sourceMathCount':math_count,'wordMathCount':row['formulas'],'tableGridFlags':table_flags,'pages':pages})
    print(row['id'],pages_count,'pages',sum(p['outsidePageCharacters'] for p in pages),'outside-page chars',flush=True)
summary={'scope':'Read-only screening; Word rendering only, flags require visual review; contact sheets do not prove every equation is correct.','documents':len(results),'pages':sum(r['pdfPages'] for r in results),'outsidePageDocuments':[r['id'] for r in results if any(p['outsidePageCharacters'] or p['outsidePageImages'] for p in r['pages'])],'outsideBodyDocuments':[r['id'] for r in results if any(p['outsideBodyCharacters'] for p in r['pages'])],'mathCountMismatch':[r['id'] for r in results if r['sourceMathCount']!=r['wordMathCount']],'tableGridDocuments':[r['id'] for r in results if r['tableGridFlags']],'results':results}
(directory/'layout-screening.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k!='results'},ensure_ascii=False))
