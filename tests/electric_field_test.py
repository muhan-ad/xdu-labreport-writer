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
                result = module._compute(legacy)
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
                self.assertIn("拟合质量提示", package.read("word/document.xml").decode("utf-8"))

    def test_theory_intercept_matches_both_electrode_boundaries(self):
        for inner, outer in [(2, 12), (0.1, 1), (0.2, 0.8)]:
            self.data.update(r_a=inner, r_b=outer)
            result = module._compute(self.data)
            self.assertAlmostEqual(result["theory_intercept"], math.log(outer) / math.log(outer / inner))
            self.assertAlmostEqual(result["theory_intercept"] + result["theory_slope"] * math.log(inner), 1)
            self.assertAlmostEqual(result["theory_intercept"] + result["theory_slope"] * math.log(outer), 0)
        self.data.update(r_a=0.1, r_b=1)
        self.assertIsNone(module._compute(self.data)["intercept_error"])

    def test_coax_axes_and_arrows_follow_scaled_data(self):
        self.data["r_a"] *= 2
        self.data["r_b"] *= 2
        self.data["coax_radii"] = [[value * 2 for value in row] for row in self.data["coax_radii"]]
        result = module._compute(self.data)
        def check(fig, unused):
            axes = fig.axes[0]
            extent = max(result["r_b"], max(map(max, result["coax_radii"])))
            self.assertLess(axes.get_xlim()[0], -extent)
            self.assertGreater(axes.get_xlim()[1], extent)
            self.assertGreater(axes.get_ylim()[1], extent)
            for annotation in axes.texts:
                if hasattr(annotation, "xy"):
                    self.assertLessEqual(math.hypot(*annotation.xy), result["r_b"] + 1e-9)
            module.plt.close(fig)
        with patch.object(module, "_save_figure", side_effect=check):
            module._plot_coax(result, None)

    def test_crossing_sample_warns_and_does_not_draw_field_arrows(self):
        result = module._compute(self.data)
        self.assertTrue(any("7 V 与 8 V" in warning and "相交" in warning for warning in result["warnings"]))
        self.assertEqual(result["parallel_x"], self.data["parallel_x"])
        def check(fig, unused):
            axes = fig.axes[0]
            self.assertFalse(any(hasattr(text, "arrow_patch") for text in axes.texts))
            self.assertTrue(all(line.get_linestyle() == "--" for line in axes.lines))
            self.assertEqual(sum(len(points.get_offsets()) for points in axes.collections), 60)
            for line in axes.lines:
                self.assertLess(axes.get_xlim()[0], min(line.get_xdata()))
                self.assertGreater(axes.get_xlim()[1], max(line.get_xdata()))
            module.plt.close(fig)
        with patch.object(module, "_save_figure", side_effect=check):
            module._plot_parallel(result, None)

    def test_degenerate_coordinates_warn_without_crashing_or_dropping_points(self):
        self.data["parallel_y"][0] = [5] * 10
        result = module._compute(self.data)
        self.assertTrue(any("没有变化" in warning for warning in result["warnings"]))
        self.assertEqual(len(result["parallel_x"][0]), 10)

    def test_no_common_y_range_warns(self):
        self.data["parallel_y"][0] = list(range(100, 110))
        result = module._compute(self.data)
        self.assertTrue(any("没有共同测量区间" in warning for warning in result["warnings"]))

    def test_shared_validator_rejects_empty_fixed_rows(self):
        from common.data_validation import validate
        schema = json.loads((EXP / "schema.json").read_text(encoding="utf-8"))
        self.data["parallel_x"][0] = [None] * 10
        result = validate(schema, self.data)
        self.assertFalse(result["ok"])
        self.assertIn("3 V", result["missing"][0]["reason"])


if __name__ == "__main__":
    unittest.main()
