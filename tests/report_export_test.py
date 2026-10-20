"""All experiment writers export directly without writing a second report."""
import contextlib, io, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from custom_plot_test import all_experiments,run_report
from docx import Document
class ExportTests(unittest.TestCase):
    def test_all_experiments_save_only_to_export_directory(self):
        for exp in all_experiments():
            with self.subTest(experiment=exp), tempfile.TemporaryDirectory() as target:
                with patch.dict(os.environ,{'LAB_REPORT_OUTPUT_DIR':target}),contextlib.redirect_stdout(io.StringIO()):
                    original=Path(run_report(exp))
                output=Path(target)/original.name
                self.assertTrue(output.exists())
                self.assertFalse(original.exists())
                self.assertGreater(len(Document(output).paragraphs),10)
    def test_missing_export_directory_does_not_fall_back(self):
        from common.docx_report import DocxReportWriter
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'LAB_REPORT_OUTPUT_DIR':str(Path(tmp)/'missing')}):
            with self.assertRaisesRegex(ValueError,'报告保存目录无效'):
                DocxReportWriter(str(Path(tmp)/'fallback.docx'))
            self.assertFalse((Path(tmp)/'fallback.docx').exists())
if __name__=='__main__':unittest.main()
