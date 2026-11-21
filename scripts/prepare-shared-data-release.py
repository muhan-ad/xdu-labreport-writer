"""Prepare a shared release from the published baseline plus an explicitly reviewed resource diff.
No upload, no personal data reads, no private key output. Existing version artifacts are immutable.
"""
from pathlib import Path
import argparse,hashlib,io,json,os,subprocess,sys,urllib.request,zipfile
p=argparse.ArgumentParser();p.add_argument('--version',required=True);p.add_argument('--audit',required=True);p.add_argument('--out',required=True);p.add_argument('--manager',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=Path(a.out).resolve();assert not out.exists(),'Release output already exists'
sys.path.insert(0,a.manager)
from core.config import load_config
cfg=load_config();desktop=Path('E:/apps/xdu-labreport-writer-master');node=os.environ.get('LAB_MAKER_NODE','E:/tools/app-maker/node/24.22.1/node.exe')
base='https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/'
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=60) as r:return r.read()
m=json.loads(get(base+'data-manifest.json'));assert m['dataVersion']=='1.2.2','Re-audit the current cloud version first'
raw=get(m['url']);assert len(raw)==m['size'] and hashlib.sha256(raw).hexdigest()==m['sha256']
# Use the desktop client's own signature verifier before trusting the source file list.
verify="const fs=require('fs'),u=require('./src/main/update-package');const m=JSON.parse(fs.readFileSync(0,'utf8'));u.verify(m,fs.readFileSync('src/update-public-key.pem'),'2.2.0','0.0.0','labreport-1485394950.cos.ap-guangzhou.myqcloud.com');"
subprocess.run([node,'-e',verify],input=json.dumps(m),text=True,cwd=desktop,check=True)
z=zipfile.ZipFile(io.BytesIO(raw));assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())==set(m['files'])
entries={}
for name in z.namelist():
 b=z.read(name);assert hashlib.sha256(b).hexdigest()==m['files'][name];assert not any(x in ('','..','.') for x in name.split('/')) and '\\' not in name
 entries[name]=b
audit=json.loads(Path(a.audit).read_text('utf8'));assert audit['version']==m['dataVersion']
replacements=[part+'/'+name for part,names in audit['changed'].items() for name in names]+audit['new']
assert all(n.endswith(('.py','schema.json')) and not n.endswith(('/data.json','/sample.json','/test-data.json')) for n in replacements)
for name in replacements:entries['实验脚本/'+name]=(desktop/'物理实验/实验脚本'/name).read_bytes()
metadata={'revision':2026110801,'label':'2026-11-08 实验数据 '+a.version+'：螺线管单位/双侧曲线、19实验报告表格与数值显示修复'}
entries['实验脚本/common/resource-release.json']=(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n').encode()
out.mkdir(parents=True);stage=out/'desktop/source'
for name,b in entries.items():
 target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
archive=out/('data-package-'+a.version+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
 for name,b in sorted(entries.items()):
  info=zipfile.ZipInfo(name,date_time=(2026,11,8,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;bundle.writestr(info,b,compresslevel=9)
notes='更新螺线管cm/mA输入、旧单位兼容及左右两侧实测曲线；同步19个实验的报告原始数据/结果表展示，报告数值最多五位有效数字。保留理想气体降温全空/全零跳过。无需升级电脑版2.2.0。'
(out/'notes.txt').write_text(notes,'utf8')
subprocess.run([node,'scripts/release-data.js','sign',str(cfg['signing_key']),str(archive),a.version,base+archive.name,str(out/'data-manifest.json'),notes],cwd=desktop,check=True)
# Preserve the exact mobile schema/layout expected by installed 0.142.0 clients.
sources=json.loads((root/'public/report-runtime/report-sources.json').read_text('utf8'))
snapshot={'catalog':json.loads((root/'src/data/catalog.json').read_text('utf8')),'runtime':json.loads((root/'public/report-runtime/manifest.json').read_text('utf8'))}
(out/'mobile-0142-context.json').write_text(json.dumps(snapshot,ensure_ascii=False),'utf8')
(out/'mobile-sources-before.json').write_text(json.dumps(sources,ensure_ascii=False),'utf8')
sources['common/resource-release.json']=entries['实验脚本/common/resource-release.json'].decode()
# The desktop addition here is a comment; runtime behavior was already fixed in mobile.
gas='理想气体状态方程/generate.py';anchor='    if all(v in (None, "", 0) for v in t_raw + dp_raw):'
comment='    # 未测降温：整组留空或用全零占位时，不绘图、不参与报告。\n'
if comment not in sources[gas]:
 assert sources[gas].count(anchor)==1;sources[gas]=sources[gas].replace(anchor,comment+anchor)
overlay={}
for name,text in sources.items():
 b=entries.get('实验脚本/'+name);up=b.decode('utf-8-sig').replace('\r\n','\n') if b is not None else None
 if text!=up:overlay[name]={'baseSha256':hashlib.sha256(up.encode()).hexdigest() if up is not None else None,'text':text}
(root/'scripts/lib/mobile-resource-overrides.json').write_text(json.dumps({'schema':1,'sourceDataVersion':a.version,'reason':'Reviewed mobile science/schema/precision adaptations; pinned to verified desktop release sources.','files':overlay},ensure_ascii=False,indent=1)+'\n','utf8')
receipt={'version':a.version,'baseVersion':m['dataVersion'],'baseSha256':m['sha256'],'replaced':replacements,'mobileOverrides':list(overlay),'payloadsPublished':False}
(out/'preparation-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'version':a.version,'desktopZipBytes':archive.stat().st_size,'replacedFiles':len(replacements),'mobileOverrides':len(overlay),'published':False}))
