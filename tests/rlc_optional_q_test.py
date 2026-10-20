"""RLC optional quality-factor regression; generates only isolated temporary reports."""
import copy,importlib.util,json,os,shutil,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'物理实验/实验脚本'
NAME='RLC电路的稳态特性研究实验'
sys.path.insert(0,str(BASE))
from common.variants import render_variant

class OptionalQTests(unittest.TestCase):
 def test_optional_q_reports(self):
  original=json.loads((BASE/NAME/'test-data.json').read_text(encoding='utf-8'))
  currents=[4.4,4.5,4.6,4.8,5.0,5.2,5.4,5.3,5.2,5.1,5.0,4.9,4.6]
  narrow=copy.deepcopy(original)
  for row,current in zip(narrow['t1'],currents):row[2]=current*narrow['R']/1000
  one_side=copy.deepcopy(narrow);one_side['t1'][0][2]=0.001*one_side['R']
  with tempfile.TemporaryDirectory() as temp:
   directory=Path(temp)/NAME;shutil.copytree(BASE/NAME,directory)
   spec=importlib.util.spec_from_file_location('rlc_q_fixture',directory/'generate.py')
   module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   variants=json.loads((directory/'variants.json').read_text(encoding='utf-8'))
   with patch.dict(os.environ,{'LAB_VARIANTS':json.dumps({'结论':0}),'LAB_POLISH':'','LAB_JOB_INPUT':''}):
    for label,data,has_q in [('covered',original,True),('both_missing',narrow,False),('one_missing',one_side,False)]:
     with self.subTest(label=label):
      result=module._compute(data);self.assertEqual(result['q'] is not None,has_q)
      if has_q:self.assertAlmostEqual(result['q'],result['f0']/result['df'])
      else:self.assertIn('无法',result['q_result']);self.assertIsNone(result['df'])
      conclusion=render_variant(variants['结论'][0],result)
      self.assertNotIn('%%DATA:',conclusion);self.assertNotIn('None',conclusion)
      target=Path(temp)/(label+'.docx');self.assertTrue(module._generate_docx(data,str(target)))
      with zipfile.ZipFile(target) as z:xml=z.read('word/document.xml').decode('utf-8')
      self.assertNotIn('%%DATA:',xml)
      if not has_q:self.assertIn('无法由半功率点法确定通频带和品质因数',xml)

if __name__=='__main__':unittest.main()
