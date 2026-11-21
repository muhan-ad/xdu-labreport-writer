"""Explicitly publish already-verified desktop/mobile resource candidates. No app update or Git push."""
from pathlib import Path
import argparse,hashlib,json,sys,urllib.request
p=argparse.ArgumentParser();p.add_argument('--candidate',required=True);p.add_argument('--manager',required=True);p.add_argument('--publish',action='store_true');a=p.parse_args()
out=Path(a.candidate).resolve();assert a.publish,'Use --publish only after candidate acceptance'
proof=json.loads((out/'compatibility-receipt.json').read_text('utf8'));assert all(proof[k] for k in ['desktop220ShippedVerifier','mobile0142LayoutAndRuntime','signedPayloadVerified','upgrade122to123','repeatIsCurrent','downgradeRejected'])
sys.path.insert(0,a.manager)
from core.config import load_config
from core.cos_client import Cos
cfg=load_config();assert not cfg['dry'];c=Cos(cfg);assert c.bucket=='labreport-1485394950' and c.region=='ap-guangzhou'
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=90) as r:return r.read()
jobs=[('data-manifest.json',out/'data-manifest.json',out/'data-package-1.2.3.zip'),('mobile-data-manifest.json',out/'mobile/mobile-data-manifest.json',out/'mobile/data-1.2.3.json')]
before={k:c.read_bytes(k) for k,_,_ in jobs}
for key,body in before.items():
 assert body is not None and json.loads(body)['dataVersion']=='1.2.2','Cloud changed; re-check before publishing'
 (out/('previous-'+key)).write_bytes(body)
receipt=[]
for key,manifestfile,bodyfile in jobs:
 m=json.loads(manifestfile.read_text('utf8'));assert m['dataVersion']=='1.2.3'
 b=bodyfile.read_bytes();assert len(b)==m['size'] and hashlib.sha256(b).hexdigest()==m['sha256']
 objectkey=m['url'].split('.myqcloud.com/',1)[1]
 if c.exists(objectkey):assert c.read_bytes(objectkey)==b,'Refusing different content at immutable version URL'
 else:c.client.upload_file(Bucket=c.bucket,Key=objectkey,LocalFilePath=str(bodyfile),ContentType='application/zip' if objectkey.endswith('.zip') else 'application/json',CacheControl='public, max-age=31536000, immutable')
 assert get(m['url'])==b,'Anonymous payload readback failed'
 receipt.append({'key':objectkey,'bytes':len(b),'sha256':m['sha256'],'anonymousVerified':True})
# Verify that both discovery pointers still match the captured baseline before activation.
for key,_,_ in jobs:assert c.read_bytes(key)==before[key],'Discovery pointer changed; activation stopped'
for key,manifestfile,_ in jobs:
 b=manifestfile.read_bytes();c.client.put_object(Bucket=c.bucket,Key=key,Body=b,ContentType='application/json',CacheControl='no-cache, no-store, must-revalidate')
 assert get(c.public_url(key))==b,'Manifest readback failed'
 receipt.append({'key':key,'version':'1.2.3','anonymousVerified':True})
(out/'published-receipt.json').write_text(json.dumps({'dataVersion':'1.2.3','objects':receipt,'appVersionsUnchanged':True},indent=2)+'\n','utf8')
print(json.dumps({'published':True,'version':'1.2.3','objects':[x['key'] for x in receipt]}))
