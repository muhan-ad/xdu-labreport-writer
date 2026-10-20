"""Public resources contain principles, never measurement fixtures or AI result snapshots."""
import json,re,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'物理实验/实验脚本'
sys.path.insert(0,str(BASE))
from common.data_validation import validate
from common.content_policy import validate_polish, inspect_text

class ResourceKnowledgeTests(unittest.TestCase):
    def test_all_experiments_share_complete_knowledge_contract(self):
        experiments=[d for d in BASE.iterdir() if (d/'schema.json').exists()]
        self.assertEqual(len(experiments),28)
        for d in experiments:
            with self.subTest(experiment=d.name):
                k=json.loads((d/'rag/knowledge.json').read_text(encoding='utf-8'))
                self.assertEqual(k['schemaVersion'],1)
                for key in ('purpose','principle','formulas','method','conditions','uncertainty','source','dataPolicy'):
                    self.assertTrue(k[key],key)
                self.assertTrue(k['dataPolicy']['userInputOnly'])
                md=(d/'rag/原理.md').read_text(encoding='utf-8')
                self.assertLess(len(md),8000)
                self.assertNotIn('<table',md)
                self.assertNotIn('![](',md)
                self.assertNotRegex(md,r'10\.48|15\.98|16～17|94\.02')
    def test_shipped_data_is_blank_and_cannot_generate(self):
        for d in BASE.iterdir():
            if not (d/'schema.json').exists():continue
            with self.subTest(experiment=d.name):
                s=json.loads((d/'schema.json').read_text(encoding='utf-8'))
                self.assertTrue(s['userInputOnly'])
                for group in s['groups']:
                    for field in group['fields']:self.assertIsNone(field.get('default'))
                for fn in ('data.json','sample.json'):
                    data=json.loads((d/fn).read_text(encoding='utf-8'))
                    def blank(v):return all(blank(x) for x in v.values()) if isinstance(v,dict) else all(blank(x) for x in v) if isinstance(v,list) else v is None
                    self.assertTrue(blank(data))
                    self.assertFalse(validate(s,data)['ok'])
    def test_ai_example_values_are_rejected_but_bound_results_allowed(self):
        for value in ['R=10.48 MΩ','误差5%','最长16秒',r'$R=10\ \mathrm{MΩ}$','参考值1500 m/s']:
            with self.subTest(value=value):
                validate_polish(value)
                self.assertTrue(inspect_text(value)['warnings'] or '$' in value)
        validate_polish('本次结果%%DATA:r_mohm:%.2f%% MΩ；$Q=Q_0e^{-t/\\tau}$')
    def test_official_variants_have_no_example_numbers(self):
        for p in BASE.glob('*/variants.json'):
            text=re.sub(r'%%DATA:[^:]+:.+?%%','',p.read_text(encoding='utf-8'))
            text=text.replace('273.15','')  # Kelvin/Celsius definition
            self.assertNotRegex(text,r'\d+\.\d+',p.parent.name)

    def test_report_variants_do_not_describe_the_software(self):
        for p in BASE.glob('*/variants.json'):
            text=re.sub(r'%%DATA:[^:]+:.+?%%','',p.read_text(encoding='utf-8'))
            self.assertNotRegex(text,r'用户|知识库|占位符|本次输入|示例拟合结果|样例[“"]理论值|展示时才舍入',p.parent.name)
            self.assertNotIn('误差应结合本次数据和仪器说明评定',text,p.parent.name)
            knowledge=json.loads((p.parent/'rag/knowledge.json').read_text(encoding='utf-8'))
            self.assertTrue(knowledge['dataPolicy']['userInputOnly'])

    def test_writing_instructions_cannot_be_imported_as_report_prose(self):
        with self.assertRaisesRegex(ValueError,'写作指导'):
            validate_polish('误差应结合本次数据和仪器说明评定。重复测量的随机分散用于A类不确定度。')

if __name__=='__main__':unittest.main()
