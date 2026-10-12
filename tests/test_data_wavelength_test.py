from pathlib import Path
import json,importlib.util,sys,copy,math
r=Path(__file__).resolve().parents[1];sys.path.insert(0,str(r/'物理实验/实验脚本'));from common.data_validation import validate
for d in (r/'物理实验/实验脚本').iterdir():
 if not (d/'test-data.json').exists():continue
 result=validate(json.loads((d/'schema.json').read_text('utf-8')),json.loads((d/'test-data.json').read_text('utf-8')))
 assert result['ok'],(d.name,result)
print('PASS 27 test-data schema validation')
d=r/'物理实验/实验脚本/平凸透镜曲率半径的测量';spec=importlib.util.spec_from_file_location('newton',d/'generate.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);data=json.loads((d/'test-data.json').read_text('utf-8'));a=g._compute(data);data['wavelength_nm']=546.1;b=g._compute(data);assert math.isclose(b['R_bar']/a['R_bar'],589.3/546.1)
for v in (None,0,-1,float('nan'),float('inf'),True):
 data['wavelength_nm']=v
 try:g._compute(data)
 except ValueError:pass
 else:raise AssertionError(v)
print('PASS wavelength recalculation and invalid values')
