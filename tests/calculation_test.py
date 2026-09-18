"""No Word: analytical oracle and invalid-input regression checks."""
import ast
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / '物理实验' / '实验脚本'))
import common  # noqa: E402  真实脚本以 from common import * 取用工具函数，这里照搬
from validate_schema import validate
EXP = ROOT / '物理实验/实验脚本/长度与体积的测量'
tree = ast.parse((EXP / 'generate.py').read_text(encoding='utf-8-sig'))
ns = {k: v for k, v in vars(common).items() if not k.startswith('__')}
ns.update({'math': math, 'T_FACTOR': [0, 0, 1.84, 1.32, 1.2, 1.14, 1.11, 1.09, 1.08],
           'SQRT3': math.sqrt(3)})
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'smartlab_ua', 'smartlab_u', '_compute'}], type_ignores=[]), 'calculation', 'exec'), ns)

class CalculationTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((EXP / 'data.json').read_text(encoding='utf-8'))
        self.schema = json.loads((EXP / 'schema.json').read_text(encoding='utf-8'))

    def test_shared_thickness_analytical_oracle(self):
        r = ns['_compute'](self.data)
        L, W, D, d, x, y = (r[k] for k in ('L', 'W', 'D_corrected', 'd_corrected', 'Lx_a', 'Ly_a'))
        gradients = [W*d, L*d, -math.pi*D*d/2, -y*d, -x*d, L*W-math.pi*D*D/4-x*y]
        uncertainties = [r[k] for k in ('uL','uW','uD','uLx','uLy','ud')]
        expected = math.sqrt(sum((g*u)**2 for g,u in zip(gradients, uncertainties)))
        self.assertAlmostEqual(r['uV'], expected, places=10)

    def test_thickness_dominant(self):
        for key in ('dl_inst','dd_inst','dx_inst'): self.data[key] = 0
        for key in ('D','d_shi','X0','X1','Y0','Y1'): self.data[key] = [self.data[key][0]] * 5
        r = ns['_compute'](self.data)
        self.assertAlmostEqual(r['uV'], abs(r['V']/r['d_corrected'])*r['ud'])

    def test_zero_negative_and_missing_inputs(self):
        for value in (0, -1, float('inf'), None):
            self.data['L'] = value
            self.assertFalse(validate(self.schema, self.data)['ok'])

    def test_invalid_geometry_has_actionable_error(self):
        self.data['D'] = [1000] * 5
        with self.assertRaisesRegex(ValueError, '面积'): ns['_compute'](self.data)

if __name__ == '__main__': unittest.main()
