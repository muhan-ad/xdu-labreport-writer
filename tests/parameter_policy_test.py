"""Parameter provenance and sample-count regression checks."""
from pathlib import Path
import unittest, json, importlib.util, math, sys, copy, tempfile, shutil, contextlib, io, zipfile
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]; BASE=ROOT/'物理实验/实验脚本'
sys.path.insert(0,str(BASE))
from common.uncertainty import t_factor, type_a
from common.data_validation import validate

def load(name):
 s=importlib.util.spec_from_file_location('parameter_'+str(abs(hash(name))),BASE/name/'generate.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def fixture(name): return json.loads((BASE/name/'test-data.json').read_text('utf-8'))

class ParameterPolicyTests(unittest.TestCase):
 def test_statistics_follow_effective_sample_count(self):
  for n,v in [(2,1.84),(3,1.32),(4,1.2),(5,1.14),(6,1.11),(7,1)]: self.assertEqual(t_factor(n),v)
  self.assertAlmostEqual(t_factor(2,.95),math.tan(math.pi*.95/2),places=9)
  self.assertAlmostEqual(t_factor(3,.95),math.sqrt(2*.95**2/(1-.95**2)),places=9)
  self.assertAlmostEqual(t_factor(5,.95),2.7764451051977987,places=9)
  for n in (0,1,True,2.5):
   with self.assertRaises(ValueError): t_factor(n)
  for p in (0,1,True,float('nan')):
   with self.assertRaises(ValueError): t_factor(3,p)
  with self.assertRaises(ValueError): type_a([1])
 def test_nominal_laser_is_only_reference(self):
  name='激光波长的测量';m=load(name);d=fixture(name);a=m._compute(d);d['lambda0_nm']=650;b=m._compute(d)
  self.assertEqual(a['lam_bar'],b['lam_bar']); self.assertNotEqual(a['eta'],b['eta'])
  self.assertAlmostEqual(b['eta'],abs(650-b['lam_bar_nm'])/650*100)
  for v in (None,0,-1,float('nan'),float('inf'),True):
   d['lambda0_nm']=v
   with self.assertRaises(ValueError): m._compute(d)
 def test_meter_effective_count(self):
  name='电表的改装与校准';m=load(name);d=fixture(name)
  self.assertEqual(m._compute(d)['t_rg'],1.32)
  d['rg']=d['rg'][:2];self.assertEqual(m._compute(d)['t_rg'],1.84)
  d['rg']=d['rg'][:1]
  with self.assertRaises(ValueError):m._compute(d)
 def test_grating_95_percent_uses_retained_count(self):
  name='光栅光谱的测量';m=load(name);d=fixture(name);m.bind_input_parameters(d,m.__dict__,m.SCRIPT_DIR);angles,wave,_=m._read_data(d);a=m._compute(angles,wave)
  self.assertEqual(a['n_kept'],3);self.assertAlmostEqual(a['t_used'],4.3026527297,places=8)
  original=m.outlier_test
  def retain_two(values):
   result=original(values[:2]);return result
  m.outlier_test=retain_two
  b=m._compute(angles,wave);self.assertEqual(b['n_kept'],2);self.assertAlmostEqual(b['t_used'],12.7062047362,places=8)
 def test_young_instrument_limits_propagate(self):
  name='拉伸法测量钢丝杨氏弹性模量';m=load(name);d=fixture(name);a=m._compute(d)
  for key,component in [('instrument_delta_L','u_L'),('instrument_delta_H','u_H'),('instrument_delta_D','u_D_m')]:
   changed=copy.deepcopy(d);changed[key]*=2;b=m._compute(changed)
   self.assertEqual(a['Y'],b['Y']);self.assertAlmostEqual(b[component],a[component]*2);self.assertGreater(b['Y_u'],a['Y_u'])
 def test_wedge_report_uses_selected_light_and_keeps_source(self):
  name='劈尖干涉';m=load(name);d=fixture(name);d['wavelength_nm']=532.17
  original=m.SCRIPT_DIR
  with tempfile.TemporaryDirectory() as tmp:
   for filename in ('schema.json','variants.json','rag/knowledge.json'):
    target=Path(tmp)/filename;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(Path(original)/filename,target)
   m.SCRIPT_DIR=tmp
   try:
    with contextlib.redirect_stdout(io.StringIO()):m._generate_docx(d,str(Path(tmp)/'report.docx'))
    with zipfile.ZipFile(Path(tmp)/'report.docx') as z:xml=ET.fromstring(z.read('word/document.xml'))
    text=''.join(e.text or '' for e in xml.iter() if e.tag.endswith('}t'))
    self.assertIn('532.17',text);self.assertNotIn('589.3',text);self.assertNotIn('钠光灯波长',text)
   finally:m.SCRIPT_DIR=original

 def test_new_parameters_blank_in_factories_and_validated(self):
  cases={'劈尖干涉':['wavelength_nm'],'激光波长的测量':['lambda0_nm'],'重力加速度的测量':['g0_source'],'拉伸法测量钢丝杨氏弹性模量':['instrument_delta_L','instrument_delta_H','instrument_delta_D']}
  for name,keys in cases.items():
   schema=json.loads((BASE/name/'schema.json').read_text('utf-8'));d=fixture(name)
   self.assertTrue(validate(schema,d)['ok'])
   for key in keys:
    for filename in ('data.json','sample.json'):self.assertIsNone(json.loads((BASE/name/filename).read_text('utf-8'))[key])
    invalid=copy.deepcopy(d);invalid[key]='  ' if key=='g0_source' else None
    self.assertFalse(validate(schema,invalid)['ok'])

if __name__=='__main__':unittest.main()
