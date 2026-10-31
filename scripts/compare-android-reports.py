"""Compare actual Android outputs against the same-source WASM reference before randomized quiz answers."""
from pathlib import Path
from lxml import etree
import json,re,zipfile
root=Path(__file__).resolve().parents[1];folder=root/'artifacts/report-tests';catalog=json.loads((root/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments']
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
def tokens(path):
 with zipfile.ZipFile(path) as z:document=etree.fromstring(z.read('word/document.xml'))
 result=[]
 for element in document.find('w:body',ns):
  texts=element.xpath('.//w:t/text()|.//m:t/text()',namespaces=ns);heading=re.sub(r'^[一二三四五六七八九十0-9、.（）()\s]+','',''.join(texts)).strip()
  if heading in ('课后思考题','思考题','实验思考题'):break
  result.extend(texts)
 return result
results=[]
for exp in catalog:
 a=tokens(folder/(exp['id']+'.docx'));b=tokens(folder/'android-corpus'/(exp['id']+'.docx'))
 result={'id':exp['id'],'name':exp['name'],'sameCalculationTextAndMath':a==b,'referenceTokens':len(a),'androidTokens':len(b)}
 if a!=b:result['differences']=[{'index':i,'reference':x,'android':y} for i,(x,y) in enumerate(zip(a,b)) if x!=y][:10]
 results.append(result);print(exp['name'],'MATCH' if a==b else result.get('differences'),flush=True)
(folder/'android-comparison.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
assert all(r['sameCalculationTextAndMath'] for r in results),'Actual Android calculation output differs'
