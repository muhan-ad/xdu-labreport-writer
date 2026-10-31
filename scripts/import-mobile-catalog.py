from pathlib import Path
import json,hashlib,re
p=Path(r'E:\project\lab-maker-app');s=Path(r'E:\apps\xdu-labreport-writer-master');r=s/'物理实验/实验脚本'
for d in ['src/data','src/domain','src/platform','tests/fixtures','docs']:(p/d).mkdir(exist_ok=True,parents=True)
rules={'mechanics':['扭摆','重力','转动惯量','拉伸法','杨氏'],'optics':['薄透镜','衍射','三棱镜','平凸','偏振','激光波长','光栅','劈尖'],'electromagnetism':['电表','电子元件','电子偏转','灵敏电流计','静电场','霍尔','螺线管','磁场','低电阻','电容','高电阻','RLC']}
items=[];fixtures={}
for f in sorted(r.glob('*/schema.json')):
 name=f.parent.name;schema=json.loads(f.read_text(encoding='utf-8-sig'))
 for g in schema['groups']:
  for field in g['fields']:
   assert re.fullmatch(r'[A-Za-z_]\w*',field['key']) and field['key'] not in ['__proto__','constructor','prototype']
 category=next((c for c,terms in rules.items() if any(t in name for t in terms)),'other')
 id=hashlib.sha256(name.encode()).hexdigest()[:12]
 items.append({'id':id,'sourceId':name,'name':name+'（第一学期）' if name=='光的偏振特性测量' else name,'category':category,'schema':schema,'schemaHash':hashlib.sha256(f.read_bytes()).hexdigest()})
 fixtures[id]=json.loads((f.parent/'test-data.json').read_text(encoding='utf-8-sig'))
order={'mechanics':0,'optics':1,'electromagnetism':2,'other':3};items.sort(key=lambda x:(order[x['category']],x['name']))
assert len(items)==28
(p/'src/data/catalog.json').write_text(json.dumps({'version':1,'sourceVersion':'2.2.0-local-20261022','experiments':items},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(p/'tests/fixtures/measurements.json').write_text(json.dumps(fixtures,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
source=(s/'src/shared/data-validation.js').read_text(encoding='utf-8-sig');body=source.split("})(typeof globalThis !== 'undefined' ? globalThis : this, function() {",1)[1].rsplit('return { validate, dimensions, blank, forEditing };',1)[0]
(p/'src/domain/validation.js').write_text('// Desktop validation body, unchanged. Source: src/shared/data-validation.js\n'+body+'\nexport const validation = {validate, dimensions, blank, forEditing};\n',encoding='utf-8')
print('Catalog',len(items),'bytes',(p/'src/data/catalog.json').stat().st_size,'categories',{c:sum(x['category']==c for x in items) for c in order})
