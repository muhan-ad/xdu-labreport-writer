"""Explicit mobile COS release. Immutable payloads first, anonymous readback, signed pointers last.
Credentials remain in the existing release manager. No desktop update pointers are changed.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,sys,urllib.request

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--manager',required=True);p.add_argument('--out',required=True);p.add_argument('--apk',required=True);p.add_argument('--publish',action='store_true');p.add_argument('--only-data',action='store_true');a=p.parse_args()
sys.path.insert(0,str(Path(a.manager).resolve()))
from core.config import load_config
from core.cos_client import Cos
cfg=load_config();assert not cfg['dry'],'Real COS configuration required'
assert cfg['cos_bucket']=='labreport-1485394950' and cfg['cos_region']=='ap-guangzhou'
out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
node=os.environ.get('LAB_MAKER_NODE','E:/tools/app-maker/node/24.22.1/node.exe')
release=json.loads((root/'src/data/resource-release.json').read_text('utf8'))
version=json.loads((root/'package.json').read_text('utf8'))['version']
appnotes=out/'app-notes.txt';appnotes.write_text('安卓测试版 '+version+'：开放应用在线更新及实验资源在线更新；内置实验资源与电脑版已发布 1.2.2 共源，保留手机版适配；教务桌面登录流程及缺失字体自动下载。保留现有应用数据。','utf8')
datanotes=out/'data-notes.txt';datanotes.write_text('实验资源 '+release['dataVersion']+'：来源为电脑版已签名发布包；包含 28 个实验。理想气体降温数据全空或全零时跳过；保留已验证的手机版科学计算、原始数据照片及数值显示适配。','utf8')
def run(args):subprocess.run([node,*args],cwd=root,check=True)
appdir=out/'app';datadir=out/'data'
if not appdir.exists():run(['scripts/prepare-app-update.mjs','--apk',str(Path(a.apk).resolve()),'--key',str(cfg['signing_key']),'--notes',str(appnotes),'--output',str(appdir),'--local-test-channel'])
if not datadir.exists():run(['scripts/build-mobile-data-package.mjs','--data-version',release['dataVersion'],'--min-app-version',version,'--out',str(datadir),'--notes-file',str(datanotes),'--signing-key',str(cfg['signing_key'])])
manifests=[('mobile-app-manifest.json',appdir/'mobile-app-manifest.json',Path(a.apk).resolve()),('mobile-data-manifest.json',datadir/'mobile-data-manifest.json',datadir/('data-'+release['dataVersion']+'.json'))]
if a.only_data:manifests=manifests[1:]
if not a.publish:print('Prepared signed candidates only; use --publish to activate');sys.exit(0)
cloud=Cos(cfg);receipt=[]
def anonymous(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=120) as r:return r.read()
for key,manifestfile,bodyfile in manifests:
 m=json.loads(manifestfile.read_text('utf8'));body=bodyfile.read_bytes();assert len(body)==m['size'] and hashlib.sha256(body).hexdigest()==m['sha256']
 objectkey=m['url'].split('.myqcloud.com/',1)[1]
 if cloud.exists(objectkey):assert hashlib.sha256(cloud.read_bytes(objectkey)).hexdigest()==m['sha256'],'Refusing immutable payload overwrite'
 else:cloud.client.upload_file(Bucket=cloud.bucket,Key=objectkey,LocalFilePath=str(bodyfile),ContentType='application/vnd.android.package-archive' if objectkey.endswith('.apk') else 'application/json',CacheControl='public, max-age=31536000, immutable')
 remote=anonymous(m['url']);assert len(remote)==m['size'] and hashlib.sha256(remote).hexdigest()==m['sha256'],'Anonymous payload verification failed'
 receipt.append({'key':objectkey,'size':len(remote),'sha256':m['sha256'],'anonymousVerified':True})
# Both payloads must be accessible before either discovery pointer is activated.
for key,manifestfile,_ in manifests:
 old=cloud.read_bytes(key)
 if old is not None:(out/('previous-'+key)).write_bytes(old)
 body=manifestfile.read_bytes();cloud.client.put_object(Bucket=cloud.bucket,Key=key,Body=body,ContentType='application/json',CacheControl='no-cache, no-store, must-revalidate')
 assert anonymous(cloud.public_url(key))==body,'Manifest readback failed'
 receipt.append({'key':key,'anonymousVerified':True})
(out/('published-data-receipt.json' if a.only_data else 'published-receipt.json')).write_text(json.dumps({'appVersion':version,'dataVersion':release['dataVersion'],'channel':'local-signer-test','objects':receipt},indent=2)+'\n','utf8')
print(json.dumps({'published':True,'appVersion':version,'dataVersion':release['dataVersion'],'objects':[x['key'] for x in receipt]}))
