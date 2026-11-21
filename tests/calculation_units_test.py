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
    def test_textbook_input_units_and_legacy_data(self):
        from common.data_validation import migrate_units, validate
        from common.official_charts import chart_specs

        hall_name = '霍尔效应实验'
        _, hall = load(hall_name)
        schema = json.loads((BASE / hall_name / 'schema.json').read_text('utf8'))
        legacy = {key: value for key, value in hall.items() if key != 't1_im_a'}
        legacy['t1_im'] = [value * 1000 for value in hall['t1_im_a']]
        self.assertEqual(migrate_units(schema, legacy)['t1_im_a'], hall['t1_im_a'])
        self.assertTrue(validate(schema, legacy)['ok'])
        self.assertFalse(validate(schema, {**hall, 't1_im_a': legacy['t1_im']})['ok'])
        self.assertIsNone(migrate_units(schema, {**legacy, 't1_im_a': None})['t1_im_a'])
        chart = chart_specs(hall_name, migrate_units(schema, legacy), str(BASE), 'hall_im')[0]
        self.assertEqual(chart['xlabel'], 'Im / A')
        self.assertEqual(chart['series'][0]['x'], hall['t1_im_a'])

        name = '衍射光强分布的测量'
        module, data = load(name)
        schema = json.loads((BASE / name / 'schema.json').read_text('utf8'))
        legacy = {key: value for key, value in data.items() if key != 'L_cm'}
        legacy['L'] = data['L_cm'] * 10
        self.assertEqual(module._read_data(migrate_units(schema, legacy))[2], legacy['L'])
        self.assertEqual(module._read_data(data)[2], legacy['L'])
        self.assertFalse(validate(schema, {**data, 'L_cm': 80})['ok'])

    def test_young_conclusion_contains_coefficient_and_physical_scale(self):
        name = '拉伸法测量钢丝杨氏弹性模量'
        module, data = load(name)
        result = module._compute(data)
        # Independently convert every input into SI; four loading steps = 4 kg.
        diameter = (sum(data['d_shi']) / len(data['d_shi']) - data['d_0']) * 1e-3
        readings = [(a+b)/2 for a,b in zip(data['ni_zheng'],data['ni_jian'])]
        displacement = sum(readings[i+4]-readings[i] for i in range(4))/4 * 1e-2
        extension = data['D']*1e-3*displacement/(2*data['H_mm']/1000)
        expected = (4*data['instrument_g'])*(data['L_mm']/1000)/(math.pi*diameter**2/4*extension)
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
                    ascending={**data, **{key: list(reversed(data[key])) for key in ('rings','d_left','d_right')}}
                    self.assertAlmostEqual(module._compute(ascending)['R_bar'],radius,places=8)

    def test_newton_rejects_orders_outside_fixed_pairing_model(self):
        module,data=load('平凸透镜曲率半径的测量')
        invalid=[list(range(40,20,-2)),[20]*10,
                 [20.5-i for i in range(10)],[9-i for i in range(10)],
                 [True]+list(range(19,10,-1)),[float('nan')]+list(range(19,10,-1))]
        for orders in invalid:
            with self.subTest(orders=orders),self.assertRaisesRegex(ValueError,'暗环序号'):
                module._compute(dict(data,rings=orders))

if __name__=='__main__':
    unittest.main()
