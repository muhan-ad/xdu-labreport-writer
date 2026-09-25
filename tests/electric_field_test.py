# -*- coding: utf-8 -*-
"""慕寒模板：原始表格、全点拟合方向与动态图片的回归测试。"""

import copy
import importlib.util
import json
import math
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "物理实验" / "实验脚本" / "静电场的模拟"
spec = importlib.util.spec_from_file_location("electric_generate", EXP / "generate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ElectricFieldTemplateTest(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((EXP / "sample.json").read_text(encoding="utf-8"))

    def test_source_table_shapes_and_key_values(self):
        self.assertEqual(len(self.data["coax_radii"]), 7)
        self.assertTrue(all(len(row) == 12 for row in self.data["coax_radii"]))
        self.assertEqual(len(self.data["parallel_x"]), 6)
        self.assertTrue(all(len(row) == 10 for row in self.data["parallel_x"]))
        self.assertEqual(self.data["coax_radii"][0][:3], [5.1, 5.19, 5.21])
        self.assertEqual(self.data["parallel_y"][1][6], 1.2)
        self.assertNotIn("parallel_bad_points", self.data)
        schema = json.loads((EXP / "schema.json").read_text(encoding="utf-8"))
        self.assertNotIn("parallel_bad_points", [field["key"]
                             for group in schema["groups"] for field in group["fields"]])

    def test_fit_uses_raw_radii_and_template_axis_order(self):
        result = module._compute(self.data)
        self.assertAlmostEqual(result["r"][0], sum(self.data["coax_radii"][0]) / 12)
        self.assertAlmostEqual(result["u_r_ua"][0], 0.1)
        self.assertAlmostEqual(result["slope"], -0.4406, places=3)
        self.assertAlmostEqual(result["intercept"], 0.8118, places=3)
        self.assertAlmostEqual(result["theory_slope"], -1 / math.log(6.5))
        self.assertGreater(result["slope_error"], 17)

    def test_legacy_summary_only_is_not_mistaken_for_full_template(self):
        with self.assertRaisesRegex(ValueError, "旧版仅有半径汇总值"):
            module._compute({"u_a": 10, "r_a": 1, "r_b": 6.5,
                             "u_r": [7, 6, 5, 4, 3, 2, 1],
                             "r": [1.65, 2.11, 2.65, 3.28, 3.95, 4.71, 5.52]})

    def test_missing_point_is_rejected(self):
        incomplete = copy.deepcopy(self.data)
        incomplete["parallel_x"][0][0] = None
        with self.assertRaisesRegex(ValueError, "未填写"):
            module._compute(incomplete)

    def test_all_ten_points_are_used_even_with_legacy_bad_point_setting(self):
        baseline = module._compute(self.data)
        legacy = copy.deepcopy(self.data)
        legacy["parallel_bad_points"] = "4:7;7:2,3"
        result = module._compute(legacy)
        self.assertNotIn("parallel_bad_points", result)
        self.assertEqual(result["parallel_x"], baseline["parallel_x"])
        self.assertEqual(result["parallel_y"], baseline["parallel_y"])
        original_polyfit = module.np.polyfit
        sizes = []

        def capture(y, x, degree):
            sizes.append((len(y), len(x), degree))
            return original_polyfit(y, x, degree)

        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(module.np, "polyfit", side_effect=capture):
                module._plot_parallel(result, str(Path(temporary) / "parallel.png"))
        self.assertEqual(sizes, [(10, 10, 2)] * 6)

    def test_report_contains_three_live_images(self):
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary) / "electric.docx"
            module._generate_docx(self.data, str(out))
            self.assertGreater(out.stat().st_size, 100_000)
            for name in ("coax_field.png", "fit_plot.png", "parallel_field.png"):
                self.assertGreater((out.parent / name).stat().st_size, 10_000)
            with zipfile.ZipFile(out) as package:
                images = [name for name in package.namelist()
                          if name.startswith("word/media/") and name.endswith(".png")]
                self.assertEqual(len(images), 3)
                self.assertNotIn("坏点", package.read("word/document.xml").decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
