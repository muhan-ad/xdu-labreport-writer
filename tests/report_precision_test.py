import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from docx import Document

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'物理实验/实验脚本'))
from common.report_precision import limit_numeric_text
from common.docx_report import DocxReportWriter

class PrecisionTests(unittest.TestCase):
    def test_decimal_artifact_and_significant_digits(self):
        for source,expected in [
            ('0.013999999999999999','0.014'),
            ('123.456789','123.46'),('0.00000123456789','1.2346e-6'),
            ('1234567','1.2346e6'),('-1.23456789e-7','-1.2346e-7'),
            ('1.23455','1.2346'),('2.5000','2.5000'),('0.00000','0.00000'),
            ('9.99999','10'),('0.00123456789','0.0012346')]:
            self.assertEqual(limit_numeric_text(source),expected)
    def test_symbols_exponents_dates_and_links_preserved(self):
        self.assertEqual(limit_numeric_text(r'B_0=0.013999999999999999^2'),r'B_0=0.014^2')
        self.assertEqual(limit_numeric_text('0.00000123456789',True),r'1.2346\times 10^{-6}')
        original='2026-10-21 https://example.com/123456789?value=1.234567'
        self.assertEqual(limit_numeric_text(original),original)
    def test_all_writer_channels_and_identity_preserved(self):
        with tempfile.TemporaryDirectory() as folder,contextlib.redirect_stdout(io.StringIO()):
            out=Path(folder)/'report.docx'
            with patch.dict(os.environ,{'LAB_STUDENT_ID':'25009300534','LAB_STUDENT_CLASS':'1234567'}):
                w=DocxReportWriter(str(out));w.add_student_info()
                w.add_paragraph('计算值：123.456789')
                w.add_math(r'B=0.013999999999999999^2')
                w.add_run('值：');w.add_inline_math('x=1.23456789')
                w.add_table(['计算值'],[['1.23456789']]);w.close()
            xml=''.join(Document(out).element.itertext())
            for value in ['25009300534','1234567','123.46','0.014','1.2346']:self.assertIn(value,xml)
            self.assertNotIn('013999999999999999',xml)
            self.assertNotIn('1.23456789',xml)
    def test_raw_tables_removed_with_or_without_photo_and_processed_retained(self):
        with tempfile.TemporaryDirectory() as folder,contextlib.redirect_stdout(io.StringIO()):
            out=Path(folder)/'report.docx'
            w=DocxReportWriter(str(out))
            w.add_table(['原始数据'],[['12.34']],role='raw')
            w.add_table(['序号','原始位置','计算量'],[['1','12.34','1.234567']],raw_columns=[1])
            w.add_table(['项目','数值'],[['原始数据','3.4'],['计算量','5.6']],raw_rows=[0])
            w.close();doc=Document(out)
            self.assertEqual(len(doc.tables),2)
            self.assertEqual([c.text for c in doc.tables[0].rows[0].cells],['序号','计算量'])
            self.assertNotIn('原始数据',''.join(doc.element.itertext()))

if __name__=='__main__':unittest.main()
