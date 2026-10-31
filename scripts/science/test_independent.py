"""Dimensional and hand-solvable checks of the independent audit itself."""
import copy
import json
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from independent_formulas import references, line, solve3
from independent_uncertainty import equal_precision, fit_uncertainty, references as uncertainty_references

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments']
SAMPLES = json.loads((ROOT/'tests/fixtures/measurements.json').read_text(encoding='utf-8'))

def sample(name):
    entry = next(e for e in CATALOG if e['sourceId'] == name)
    return copy.deepcopy(SAMPLES[entry['id']])

def values(name, data):
    return {key: value for key, value, *_ in references(name, data)}

class IndependentChecks(unittest.TestCase):
    def test_solenoid_uncertainty_hand_solved_single_readings(self):
        # M=1 H, I=1 A, each displacement=1 cm, u(single)=1 cm.
        # RKb=.1, u(RKb)=.1/sqrt(2), B=1 T, u(B)=1 T.
        d=sample('直螺线管磁场分布的测量')
        d.update(M_mH=1000,I0_ma=[1000]*3,dm1_cm=[1]*3,dm2_cm=[1]*3,
                 instrument_delta_scale_mm=10*math.sqrt(3),instrument_delta_ammeter_a=0,
                 n_coil=1,S_m2=1,d_left_cm=[1]*16,d_right_cm=[1]*16)
        r={k:v for k,v,*_ in uncertainty_references('直螺线管磁场分布的测量',d)}
        self.assertEqual(r['u_A_RKb'],0)
        self.assertAlmostEqual(r['u_B_RKb'],.1/math.sqrt(2))
        self.assertAlmostEqual(r['u_B_center'],1)

    def test_solenoid_uncertainty_instrument_scaling_and_pair_mean(self):
        d=sample('直螺线管磁场分布的测量')
        before={k:v for k,v,*_ in uncertainty_references('直螺线管磁场分布的测量',d)}
        d['instrument_delta_scale_mm']*=3;d['instrument_delta_ammeter_a']*=3
        after={k:v for k,v,*_ in uncertainty_references('直螺线管磁场分布的测量',d)}
        self.assertAlmostEqual(after['u_B_RKb']/before['u_B_RKb'],3)
        self.assertEqual(after['u_A_RKb'],before['u_A_RKb'])
        self.assertAlmostEqual(before['u_dm_single_cm']/before['u_dm_mean_cm'],math.sqrt(2))

    def test_uncertainty_hand_solved_sample(self):
        self.assertAlmostEqual(equal_precision([1,2,3]), 1.32/math.sqrt(3))
        self.assertEqual(equal_precision([5]*8), 0)
        self.assertAlmostEqual(equal_precision([0,2]*4), math.sqrt(8/7)/math.sqrt(8))

    def test_uncertainty_rejects_unsupported_or_degenerate_samples(self):
        for values in ([1], [0]*15+[100]):
            with self.assertRaises(ValueError): equal_precision(values)
        with self.assertRaises(ValueError): fit_uncertainty([1,1,1], [2,3,4])
        with self.assertRaises(ValueError): fit_uncertainty([1,2,3], [2,3])

    def test_regression_uncertainty_hand_solved_residuals(self):
        k, uk, ub = fit_uncertainty([-1,0,1], [1,0,1])
        self.assertEqual(k, 0)
        self.assertAlmostEqual(uk, math.sqrt(1/3))
        self.assertAlmostEqual(ub, math.sqrt(2/9))

    def test_regression_uncertainty_scales_with_residual_noise(self):
        x = [-2,-1,0,1,2]
        # This residual vector is orthogonal to the intercept and slope columns.
        noise = [1,-2,2,-2,1]
        before = fit_uncertainty(x, [3*v+7+e for v,e in zip(x,noise)])
        after = fit_uncertainty(x, [3*v+7+4*e for v,e in zip(x,noise)])
        self.assertEqual(before[0], after[0])
        self.assertAlmostEqual(after[1]/before[1], 4)
        self.assertAlmostEqual(after[2]/before[2], 4)

    def test_concave_two_position_readings_have_sqrt_two_type_b(self):
        d = sample('薄透镜焦距的测量（凹透镜）')
        d.update(f_auto=[15]*8, x6=[9]*8, x7=[24]*8)
        r = {k:v for k,v,*_ in uncertainty_references('薄透镜焦距的测量（凹透镜）',d)}
        self.assertEqual(r['uA_ca'], 0)
        self.assertAlmostEqual(r['uB_ca']/r['u_auto'], math.sqrt(2))
        self.assertEqual(r['uB_ca'], r['u_ca'])

    def test_laser_uncertainty_propagation_and_units(self):
        d = sample('激光波长的测量')
        d['measurements'] = [[i,i+0.015625] for i in range(8)]
        r = {k:v for k,v,*_ in uncertainty_references('激光波长的测量',d)}
        self.assertEqual(r['u_A'], 0)
        self.assertAlmostEqual(r['u_lam'], 2*d['instrument_delta_inst_mm']/math.sqrt(3)/d['N'])
        self.assertAlmostEqual(r['u_lam_nm']/r['u_lam'], 1e6)

    def test_hand_solved_linear_and_matrix_systems(self):
        self.assertEqual(line([0,1,2], [2,5,8]), (3,2))
        actual = solve3([[2,1,0],[0,3,1],[1,0,2]], [4,9,7])
        for a,b in zip(actual,[1,2,3]): self.assertAlmostEqual(a,b)

    def test_rigid_inertia_uncertainty_scales_with_instrument_inputs(self):
        name='刚体转动惯量的测量';d=sample(name)
        for i in range(4):d['measurements'][i]=[d['measurements'][i][0]]*5
        first={k:v for k,v,*_ in uncertainty_references(name,d)}
        self.assertEqual(first['u_rA'],0)
        self.assertAlmostEqual(first['u_rB'],d['instrument_delta_ruler']/math.sqrt(3))
        self.assertAlmostEqual(first['u_m0'],d['instrument_delta_balance']/1000)
        for key in ('instrument_delta_ruler','instrument_delta_timer','instrument_delta_balance'):d[key]*=3
        second={k:v for k,v,*_ in uncertainty_references(name,d)}
        self.assertAlmostEqual(second['u_I0']/first['u_I0'],3)

    def test_rlc_unit_conversion_with_exact_one_henry_one_farad(self):
        name='RLC电路的稳态特性研究实验'; d=sample(name)
        d.update(L=1000, C=1_000_000, f0p=1/(2*math.pi)/1000)
        r=values(name,d)
        self.assertAlmostEqual(r['f0'],1/(2*math.pi)/1000, places=15)
        self.assertEqual(r['eta'],0)

    def test_torsion_wire_diameter_fourth_power(self):
        name='扭摆法测量钢丝切变模量'; d=sample(name); before=values(name,d)['G']
        for key in ('d_horiz','d_vert'): d[key]=[v*2 for v in d[key]]
        d['d_zero']*=2
        self.assertAlmostEqual(values(name,d)['G']/before,1/16)

    def test_solenoid_calibration_and_theory_currents_are_distinct(self):
        name='直螺线管磁场分布的测量'; d=sample(name); before=values(name,d)
        d['I_mA']*=2; after=values(name,d)
        self.assertEqual(after['RKb_mean'],before['RKb_mean'])
        self.assertEqual(after['B_exp_center'],before['B_exp_center'])
        self.assertAlmostEqual(after['B0_theory']/before['B0_theory'],2)

    def test_capacitor_reference_scales_capacitance_and_inverse_resistance(self):
        name='电容与高电阻的测量'; d=sample(name); before=values(name,d)
        d['c_n']*=2; after=values(name,d)
        self.assertAlmostEqual(after['c_x_bar']/before['c_x_bar'],2)
        self.assertAlmostEqual(after['r_mohm']/before['r_mohm'],.5)

    def test_geometric_volume_scales_cubically(self):
        name='长度与体积的测量'; d=sample(name); before=values(name,d)['V']
        for key in ('D','d_shi','X0','X1','Y0','Y1'): d[key]=[v*3 for v in d[key]]
        for key in ('d0_card','d0','L','W'): d[key]*=3
        self.assertAlmostEqual(values(name,d)['V']/before,27)

if __name__ == '__main__': unittest.main()
