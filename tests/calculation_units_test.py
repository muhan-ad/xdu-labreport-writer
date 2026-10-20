"""Independent unit and Newton-ring order oracles; no real user files are written."""
import importlib.util
import json
import math
from pathlib import Path
import sys
import unittest

BASE = Path(__file__).resolve().parents[1] / '物理实验/实验脚本'
sys.path.insert(0, str(BASE))
from common.variants import render_variant

def load(name):
    spec = importlib.util.spec_from_file_location('units_' + str(abs(hash(name))), BASE / name / 'generate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = json.loads((BASE / name / 'test-data.json').read_text('utf8'))
    return module, data

class CalculationUnitTests(unittest.TestCase):
    def test_young_conclusion_contains_coefficient_and_physical_scale(self):
        name = '拉伸法测量钢丝杨氏弹性模量'
        module, data = load(name)
        result = module._compute(data)
        # Independently convert every input into SI; four loading steps = 4 kg.
        diameter = (sum(data['d_shi']) / len(data['d_shi']) - data['d_0']) * 1e-3
        readings = [(a+b)/2 for a,b in zip(data['ni_zheng'],data['ni_jian'])]
        displacement = sum(readings[i+4]-readings[i] for i in range(4))/4 * 1e-2
        extension = data['D']*1e-3*displacement/(2*data['H'])
        expected = (4*data['instrument_g'])*data['L']/(math.pi*diameter**2/4*extension)
        self.assertAlmostEqual(result['Y']*1e11/expected, 1, places=12)
        variant = json.loads((BASE/name/'variants.json').read_text('utf8'))['结论'][0]
        conclusion = render_variant(variant,result)
        self.assertIn(r'\times 10^{11}', conclusion)
        self.assertIn(r'\pm', conclusion)
        self.assertIn('Pa', conclusion)

    def test_newton_ideal_data_recovers_radius_for_shifted_contiguous_orders(self):
        module,data=load('平凸透镜曲率半径的测量')
        for highest in (20,30,40):
            for radius in (1000,1750):
                with self.subTest(highest=highest,radius=radius):
                    data['rings']=list(range(highest,highest-10,-1))
                    wave=data['wavelength_nm']*1e-6
                    data['d_left']=[0.0]*10
                    data['d_right']=[math.sqrt(4*n*wave*radius) for n in data['rings']]
                    self.assertAlmostEqual(module._compute(data)['R_bar'],radius,places=8)

    def test_newton_rejects_orders_outside_fixed_pairing_model(self):
        module,data=load('平凸透镜曲率半径的测量')
        invalid=[list(range(40,20,-2)),list(range(11,21)),[20]*10,
                 [20.5-i for i in range(10)],[9-i for i in range(10)],
                 [True]+list(range(19,10,-1)),[float('nan')]+list(range(19,10,-1))]
        for orders in invalid:
            with self.subTest(orders=orders),self.assertRaisesRegex(ValueError,'暗环序号'):
                module._compute(dict(data,rings=orders))

if __name__=='__main__':
    unittest.main()
