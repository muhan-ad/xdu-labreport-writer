"""Add pinned scientific WASM wheels without refreshing desktop experiment resources."""
from pathlib import Path
import hashlib,json,urllib.request,concurrent.futures
ROOT=Path(__file__).resolve().parents[1]
CORE=Path(r'E:\tools\app-maker\report-runtime-lab\node_modules\pyodide')
DEST=ROOT/'public/report-runtime'
manifest=json.loads((DEST/'manifest.json').read_text(encoding='utf-8'))
assert manifest['runtimeVersion']=='0.29.3'
full=json.loads((CORE/'pyodide-lock.json').read_text(encoding='utf-8'))
assert json.loads((CORE/'package.json').read_text(encoding='utf-8'))['version']==manifest['runtimeVersion']
lock=json.loads((DEST/'pyodide-lock.json').read_text(encoding='utf-8'))
selected={}
def visit(name):
 if name in selected:return
 selected[name]=full['packages'][name]
 for dep in selected[name]['depends']:visit(dep)
for name in ['scipy','pandas']:visit(name)
def stage(item):
 filename=item['file_name'];assert '/' not in filename and '\\' not in filename
 target=DEST/filename
 if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=item['sha256']:
  request=urllib.request.Request(manifest['source']+filename,headers={'User-Agent':'LabMaker-build/0.24'})
  with urllib.request.urlopen(request,timeout=60) as response:content=response.read(40*1024*1024+1)
  assert len(content)<=40*1024*1024 and hashlib.sha256(content).hexdigest()==item['sha256'],filename
  part=target.with_suffix(target.suffix+'.part');part.write_bytes(content);part.replace(target)
 return filename,{'bytes':target.stat().st_size,'sha256':item['sha256']}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for filename,entry in pool.map(stage,selected.values()):manifest['files'][filename]=entry
lock['packages'].update(selected)
(DEST/'pyodide-lock.json').write_text(json.dumps(lock,separators=(',',':')),encoding='utf-8')
content=(DEST/'pyodide-lock.json').read_bytes();manifest['files']['pyodide-lock.json']={'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'selected':list(selected),'runtimeBytes':sum(e['bytes'] for e in manifest['files'].values())}))
