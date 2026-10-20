import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('data_validation', ROOT / '物理实验/实验脚本/common/data_validation.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SCHEMA = json.loads((ROOT / '物理实验/实验脚本/电子偏转特性的测量/schema.json').read_text(encoding='utf8'))

def data(n):
    out = {}
    for group in SCHEMA['groups']:
        a, m = group['fields']
        out[a['key']] = list(range(n))
        out[m['key']] = [[i * (r + 1) for i in range(n)] for r in range(3)]
    return out

class VariablePointsTest(unittest.TestCase):
    def test_actual_points(self):
        for n in (3, 7, 9, 11, 100):
            self.assertTrue(module.validate(SCHEMA, data(n))['ok'], n)

    def test_missing_pairs_and_minimum(self):
        d = data(9)
        d['Im'][0].pop()
        self.assertFalse(module.validate(SCHEMA, d)['ok'])
        for n in (2, 101):
            self.assertFalse(module.validate(SCHEMA, data(n))['ok'])

if __name__ == '__main__':
    unittest.main()
