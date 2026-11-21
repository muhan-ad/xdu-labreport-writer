import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '物理实验/实验脚本'
EXP = BASE / '理想气体状态方程'
sys.path.insert(0, str(BASE))
from common.official_charts import chart_specs, render_specs
spec = importlib.util.spec_from_file_location('gas', EXP / 'generate.py')
gas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gas)

class CoolingTests(unittest.TestCase):
 def test_render_and_report(self):
  original = json.loads((EXP / 'test-data.json').read_text(encoding='utf-8'))
  with tempfile.TemporaryDirectory() as tmp:
   gas.SCRIPT_DIR = tmp
   for mode in ('empty', 'zeros', 'measured'):
    d = copy.deepcopy(original)
    if mode != 'measured':
     d['cool_t'] = [None if mode == 'empty' else 0] * 10
     d['cool_dp'] = list(d['cool_t'])
    before = copy.deepcopy(d)
    charts = chart_specs('理想气体状态方程', d, str(BASE))
    self.assertEqual(len(charts[1]['series']), 2 if mode == 'measured' else 1)
    images = render_specs(charts, str(Path(tmp)/f'{mode}.png'), str(BASE))
    self.assertEqual(len(images), 2)
    self.assertTrue(gas._generate_docx(d, str(Path(tmp)/f'{mode}.docx')))
    from docx import Document
    report = Document(str(Path(tmp)/f'{mode}.docx'))
    if mode != 'measured':
     self.assertFalse(any('同时绘出降温' in p.text for p in report.paragraphs))
    self.assertEqual(d, before)
 def test_half_pair_rejected(self):
  missing = []
  gas._load_cooling({'cool_t':[30], 'cool_dp':[None]}, missing)
  self.assertTrue(missing)

if __name__ == '__main__': unittest.main()
