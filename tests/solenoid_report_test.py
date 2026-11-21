"""Unit conversion, side pairing and real record regression."""
import contextlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
EXP=ROOT/'物理实验/实验脚本/直螺线管磁场分布的测量'
sys.path.insert(0,str(EXP.parent))
from common.data_io import load_data
from common.official_charts import chart_specs
spec=importlib.util.spec_from_file_location('solenoid_report',EXP/'generate.py')
gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)

class SolenoidTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((EXP/'test-data.json').read_text(encoding='utf-8'))
    def test_axes_pairing_preserves_asymmetry_and_signed_readings(self):
        d=self.data
        d['d_left_cm']=[v+.13 for v in d['d_left_cm']]
        d['d_left_cm'][-1]=-.1;d['d_right_cm'][-1]=.1
        chart=chart_specs(EXP.name,d,str(EXP.parent))[0]
        left,right=chart['series']
        self.assertEqual(list(zip(left['x'],left['y'])),sorted(zip([-x for x in d['x_mm']],d['d_left_cm'])))
        self.assertEqual(right['y'],d['d_right_cm'])
        self.assertEqual(left['y'][0],-.1)
        self.assertEqual(right['y'][-1],.1)
        self.assertEqual(chart['xlim'],[-200,200])
        self.assertIn('cm',chart['ylabel'])
    def test_legacy_si_values_converted_once_before_validation(self):
        d=self.data;I=d.pop('I_mA');r=d.pop('r0_cm')
        d.update(I_A=I/1000,r0_m=r/100)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)
            (p/'schema.json').write_bytes((EXP/'schema.json').read_bytes())
            (p/'data.json').write_text(json.dumps(d),encoding='utf-8')
            actual=load_data(str(p/'data.json'))
            self.assertEqual(actual['I_mA'],I);self.assertEqual(actual['r0_cm'],r)
            actual['I_mA']=117
            (p/'data.json').write_text(json.dumps(actual),encoding='utf-8')
            self.assertEqual(load_data(str(p/'data.json'))['I_mA'],117)
    def test_current_record_independent_oracle_and_report_units(self):
        from docx import Document
        d=self.data
        d.update(M_mH=7.12,N=4550,l_m=.302,r0_cm=1.4,n_coil=2690,S_m2=.000095,I_mA=117,
                 I0_ma=[80,118,142],dm1_cm=[5.2,7.8,9.5],dm2_cm=[5.2,7.9,9.45])
        d['d_left_cm'][0]=5.6;d['d_right_cm'][0]=5.7
        theory=4*math.pi*1e-7*4550*.117/math.sqrt(.302**2+4*.014**2)
        self.assertAlmostEqual(theory,.002205675068074591)
        stream=io.StringIO()
        with tempfile.TemporaryDirectory() as folder,contextlib.redirect_stdout(stream):
            out=Path(folder)/'report.docx'
            with patch.object(gen,'SCRIPT_DIR',str(EXP)),patch.object(gen,'_plot_dm_x'),patch.object(gen,'render_custom_plot',return_value=True),patch.dict('os.environ',{'LAB_POLISH':'','LAB_CUSTOM_QUIZ':'','LAB_VARIANT_SELECTION':''}):
                gen._generate_docx(d,str(out))
            text=''.join(Document(out).element.itertext())
            self.assertIn('0.117',text);self.assertIn('0.014',text)
            self.assertIn('8.01%',text)
        self.assertIn('2.2057e-03',stream.getvalue())

if __name__=='__main__':unittest.main()
