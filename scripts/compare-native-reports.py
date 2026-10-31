"""Independent native CPython reference: no desktop data.json is read or changed."""
from pathlib import Path
import json,shutil,os,sys,importlib.util,random,contextlib,io,zipfile,tempfile,re
from lxml import etree
root=Path(__file__).resolve().parents[1];base=Path(r'E:\tools\app-maker\report-runtime-lab\native-reference');base.mkdir(parents=True,exist_ok=True)
os.environ['MPLCONFIGDIR']=str(base/'matplotlib-cache')
sources=json.loads((root/'public/report-runtime/report-sources.json').read_text(encoding='utf-8'))
for name,text in sources.items():
 p=base/'source'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
sys.path.insert(0,str(base/'source'))
from common.data_io import load_data
catalog=json.loads((root/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments'];samples=json.loads((root/'tests/fixtures/measurements.json').read_text(encoding='utf-8'))
namespace={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
def content(path):
 with zipfile.ZipFile(path) as z:
  doc=etree.fromstring(z.read('word/document.xml'));return doc.xpath('//w:t/text()|//m:t/text()',namespaces=namespace),len(doc.xpath('//m:oMath',namespaces=namespace))
results=[];out=root/'artifacts/report-tests';out.mkdir(exist_ok=True,parents=True)
for exp in catalog:
 name=exp['sourceId'];target=base/'source'/name;(target/'data.json').write_text(json.dumps(samples[exp['id']],ensure_ascii=False),encoding='utf-8')
 with tempfile.TemporaryDirectory(dir=base,prefix='job-') as tmp:
  work=Path(tmp);(work/'job.json').write_text(json.dumps({'variants':{}}),encoding='utf-8');os.chdir(work)
  for key in list(os.environ):
   if key.startswith('LAB_'):del os.environ[key]
  os.environ.update(LAB_JOB_INPUT=str(work/'job.json'),LAB_STUDENT_NAME='移动端验证',LAB_STUDENT_ID='001234',LAB_STUDENT_CLASS='测试班',LAB_STUDENT_DATE='2026-10-22')
  random.seed(42);spec=importlib.util.spec_from_file_location('_native_generator',target/'generate.py');module=importlib.util.module_from_spec(spec)
  with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):spec.loader.exec_module(module);module._generate_docx(load_data(str(target/'data.json')),str(work/'report.docx'))
  wasm=out/(exp['id']+'.docx');a,ma=content(wasm);b,mb=content(work/'report.docx');same=a==b and ma==mb
  differences=[]
  for i,(x,y) in enumerate(zip(a,b)):
   if x==y:continue
   context=''.join(a[max(0,i-4):i])
   residual_roundoff=False
   if name=='光的偏振特性测量（第二学期）':
    # Only this harmonic-fit case permits numerical-zero coefficients/RMSE.
    # Keep all original tokens in the evidence; never alter either report.
    number=re.compile(r'(?<![A-Za-z0-9_.])[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?(?![\d.])')
    def normalized(token):return number.sub(lambda m:'<fit-zero>' if abs(float(m.group()))<1e-12 else m.group(),token)
    residual_roundoff=normalized(x)==normalized(y)
   differences.append({'index':i,'wasm':x,'native':y,'withinNearZeroFitTolerance':residual_roundoff})
  equivalent=len(a)==len(b) and ma==mb and all(d['withinNearZeroFitTolerance'] for d in differences)
  entry={'id':exp['id'],'name':name,'sameTextAndMath':same,'equivalentWithinDocumentedRoundoff':equivalent,'wasmMath':ma,'nativeMath':mb,'differences':differences}
  if not same:
   entry['firstMismatch']=next(({'index':i,'wasm':x,'native':y} for i,(x,y) in enumerate(zip(a,b)) if x!=y),{'wasmTokens':len(a),'nativeTokens':len(b)})
  results.append(entry);print(name,'MATCH' if same else ('NEAR-ZERO FIT ROUND-OFF' if equivalent else entry['firstMismatch']),flush=True);os.chdir(base)
(out/'native-comparison.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
assert all(x['equivalentWithinDocumentedRoundoff'] for x in results),'Native / WASM report text or formula differs'

