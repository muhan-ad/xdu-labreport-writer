"""Stage a minimal, checksummed, offline Python/WASM report runtime. Never copy user data."""
from pathlib import Path
import json,hashlib,urllib.request,concurrent.futures,shutil,argparse
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--core',default=r'E:\tools\app-maker\report-runtime-lab\node_modules\pyodide');parser.add_argument('--desktop',default=r'E:\apps\xdu-labreport-writer-master');args=parser.parse_args()
core=Path(args.core);desktop=Path(args.desktop);dest=ROOT/'public/report-runtime';dest.mkdir(parents=True,exist_ok=True)
(dest/'package.json').write_text('{"type":"commonjs"}',encoding='utf-8')
version='0.29.3';lock=json.loads((core/'pyodide-lock.json').read_text(encoding='utf-8'));selected={}
def select(name):
 if name in selected:return
 item=lock['packages'][name];selected[name]=item
 for dep in item['depends']:select(dep)
for name in ['numpy','matplotlib','lxml','pillow','scipy','pandas']:select(name)
for name in ['pyodide.js','pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip']:shutil.copy2(core/name,dest/name)
manifest={'runtimeVersion':version,'source':'https://cdn.jsdelivr.net/pyodide/v'+version+'/full/','files':{},'pureWheels':[]}
def download(url,path,digest=None):
 if path.exists() and (digest is None or hashlib.sha256(path.read_bytes()).hexdigest()==digest):return
 request=urllib.request.Request(url,headers={'User-Agent':'LabMaker-build/0.2'})
 with urllib.request.urlopen(request,timeout=60) as response:content=response.read(100*1024*1024)
 if digest and hashlib.sha256(content).hexdigest()!=digest:raise ValueError('SHA mismatch: '+path.name)
 part=path.with_suffix(path.suffix+'.part');part.write_bytes(content);part.replace(path)
 print('Downloaded',path.name,len(content),flush=True)
def stage(item):download(manifest['source']+item['file_name'],dest/item['file_name'],item['sha256'])
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(stage,selected.values()))
(dest/'pyodide-lock.json').write_text(json.dumps({'info':lock['info'],'packages':selected},separators=(',',':')),encoding='utf-8')
for name,ver in [('python-docx','1.2.0'),('openpyxl','3.1.5'),('et-xmlfile','2.0.0'),('latex2mathml','3.81.0'),('mathml2omml','0.0.2'),('typing-extensions','4.16.0')]:
 with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{ver}/json',timeout=30) as r:metadata=json.load(r)
 wheel=next(x for x in metadata['urls'] if x['filename'].endswith('py3-none-any.whl') or x['filename'].endswith('py2.py3-none-any.whl'))
 download(wheel['url'],dest/wheel['filename'],wheel['digests']['sha256']);manifest['pureWheels'].append(wheel['filename'])
# Bundle source bytes, not executable data/configuration from any desktop user profile.
source=desktop/'物理实验/实验脚本';sources={};catalog=json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))
for f in sorted((source/'common').rglob('*')):
 if f.is_file() and f.suffix in ('.py','.json','.md','.txt') and '__pycache__' not in f.parts:sources[f.relative_to(source).as_posix()]=f.read_text(encoding='utf-8-sig')
for exp in catalog['experiments']:
 assert hashlib.sha256((source/exp['sourceId']/'schema.json').read_bytes()).hexdigest()==exp['schemaHash'], 'Template changed; refresh catalog first'
 for f in sorted((source/exp['sourceId']/'rag').rglob('*')):
  if f.is_file() and f.suffix in ('.json','.md','.txt'):sources[f.relative_to(source).as_posix()]=f.read_text(encoding='utf-8-sig')
 for name in ['generate.py','schema.json','variants.json','report_integrity.py']:
  f=source/exp['sourceId']/name
  if f.exists():sources[f.relative_to(source).as_posix()]=f.read_text(encoding='utf-8-sig')
# Source archive is JSON for deterministic, browser-safe filesystem staging.
(dest/'report-sources.json').write_text(json.dumps(sources,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
download('https://raw.githubusercontent.com/pyodide/pyodide/0.29.3/LICENSE',dest/'Pyodide-LICENSE.txt')
for filename in ['LICENSE','README.md']:
 f=desktop/'物理实验'/filename
 if f.exists():shutil.copy2(f,dest/('desktop-'+filename+'.txt'))
# An OFL font subset keeps Chinese labels readable without bundling Windows fonts.
font_cache=Path(r'E:\tools\app-maker\cache\fonts');font_cache.mkdir(parents=True,exist_ok=True)
font=font_cache/'NotoSansSC.ttf';download('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',font)
download('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt',dest/'NotoSansSC-OFL.txt')
from fontTools import subset
from fontTools.ttLib import TTFont
chars=set(''.join(sources.values())+'左右侧轴线测量计算拟合原始数据理论实验电流电压单位位置差值标准不确定度参考结果标题图片图表年月日姓名学号班级0123456789−±×πμΩ°αβγδεζηθλσΔ下')
options=subset.Options();options.name_IDs=['*'];options.name_legacy=True;options.name_languages=['*'];options.layout_features=['*']
from fontTools.varLib.instancer import instantiateVariableFont
f=TTFont(font);instantiateVariableFont(f,{'wght':400},inplace=True)
for record in f['name'].names:
 if record.nameID in (1,4,6,16):record.string=('LabMakerSC-Regular' if record.nameID==6 else 'Lab Maker SC').encode(record.getEncoding())
subsetter=subset.Subsetter(options=options);subsetter.populate(text=''.join(sorted(chars)));subsetter.subset(f);f.save(dest/'LabMakerSansSC.ttf')
for f in sorted(dest.iterdir()):
 if f.is_file() and f.name!='manifest.json':manifest['files'][f.name]={'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Offline runtime bytes',sum(x['bytes'] for x in manifest['files'].values()),'packages',len(selected),'sources',len(sources))
