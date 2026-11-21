"""Generate all 28 desktop reports using the staged release and synthetic regression fixtures only."""
from pathlib import Path
import contextlib,hashlib,importlib.util,io,json,os,sys
stage=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve();output.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(stage/'实验脚本'))
from docx import Document
fixtures=json.loads(Path('E:/apps/xdu-labreport-writer-master/tests/fixtures/experiment-data.json').read_text('utf8'))
for k in list(os.environ):
 if k.startswith('LAB_'):os.environ.pop(k,None)
os.environ['LAB_STUDENT_NAME']='资源包验收';os.environ['LAB_STUDENT_ID']='0000000000';os.environ['LAB_STUDENT_CLASS']='验证班'
results=[]
for i,exp in enumerate(sorted(p for p in (stage/'实验脚本').iterdir() if (p/'generate.py').is_file())):
 try:
  spec=importlib.util.spec_from_file_location('release_exp_'+str(i),exp/'generate.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  target=output/(str(i)+'.docx')
  with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):mod._generate_docx(fixtures[exp.name],str(target))
  doc=Document(target);assert len(doc.paragraphs)>10;assert target.stat().st_size>10000
  results.append({'experiment':exp.name,'pass':True,'bytes':target.stat().st_size});print('PASS',exp.name,flush=True)
 except Exception as e:
  results.append({'experiment':exp.name,'pass':False,'error':str(e)});print('FAIL',exp.name,type(e).__name__,str(e),flush=True)
(output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),'utf8')
assert len(results)==28 and all(x['pass'] for x in results),'Staged report generation failed'
