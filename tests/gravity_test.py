"""重力实验：平均值来源、自动等周期选线和坏数据拦截。"""
import copy
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT / "物理实验" / "实验脚本" / "重力加速度的测量"
spec = importlib.util.spec_from_file_location("gravity_generate", EXP / "generate.py")
gravity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gravity)


class GravityTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((EXP / "sample.json").read_text(encoding="utf-8"))

    def test_horizontal_line_crosses_both_measured_branches(self):
        result = gravity._compute(self.data)
        self.assertLess(min(self.data["h"]), result["h1"])
        self.assertLess(result["h1"], result["h2"])
        self.assertLess(result["h2"], max(self.data["h"]))
        self.assertLess(min(result["T_avg"]), result["T0"])
        self.assertLess(result["T0"], max(result["T_avg"]))
        self.assertTrue(8 < result["g_calc"] < 12)

    def test_old_manual_intersections_are_ignored(self):
        expected = gravity._compute(self.data)
        self.data.update({"T0": 0.1, "h1": 100, "h2": 200})
        result = gravity._compute(self.data)
        self.assertEqual((result["T0"], result["h1"], result["h2"]),
                         (expected["T0"], expected["h1"], expected["h2"]))

    def test_old_data_without_average_row_uses_ten_cycle_readings(self):
        expected = gravity._compute(self.data)
        self.data.pop("T_avg")
        result = gravity._compute(self.data)
        for actual, wanted in zip(result["T_avg"], expected["T_avg"]):
            self.assertAlmostEqual(actual, wanted, places=3)

    def test_recognized_average_row_drives_plot_and_selection(self):
        changed = copy.deepcopy(self.data)
        changed["trials"] = [[v * 1.02 for v in row] for row in changed["trials"]]
        changed["T_avg"] = [v * 1.02 for v in changed["T_avg"]]
        result = gravity._compute(changed)
        self.assertAlmostEqual(result["T_avg"][0], self.data["T_avg"][0] * 1.02)
        self.assertAlmostEqual(result["T0"], gravity._compute(self.data)["T0"] * 1.02)

    def test_inconsistent_average_is_rejected(self):
        self.data["T_avg"][8] = 1.05
        with self.assertRaisesRegex(ValueError, "第 9 孔单周期平均值与 10 周期读数不一致"):
            gravity._compute(self.data)

    def test_no_two_branches_is_rejected_even_with_stale_manual_values(self):
        self.data.pop("T_avg")
        self.data["trials"] = [[10 + i] * 8 for i in range(9)]
        self.data.update({"T0": 0.898, "h1": 5, "h2": 15})
        with self.assertRaisesRegex(ValueError, "最低点靠近边界"):
            gravity._compute(self.data)

    def test_plot_axis_limits_follow_actual_data(self):
        original = gravity._compute(self.data)
        x0, y0 = gravity._plot_axis_limits(self.data["h"], original["T_avg"])
        shifted_h = [h + 40 for h in self.data["h"]]
        scaled_periods = [t * 1.5 for t in original["T_avg"]]
        x1, y1 = gravity._plot_axis_limits(shifted_h, scaled_periods)
        self.assertAlmostEqual(x1[0] - x0[0], 40)
        self.assertAlmostEqual(x1[1] - x0[1], 40)
        self.assertAlmostEqual(y1[0] / y0[0], 1.5)
        self.assertAlmostEqual(y1[1] / y0[1], 1.5)
        self.assertLess(x0[0], min(self.data["h"]))
        self.assertGreater(y0[1], max(original["T_avg"]))

    def test_narrow_common_range_with_two_intersections_is_not_blocked(self):
        h = [24.95, 22.95, 20.95, 18.95, 16.95, 14.95, 12.95, 10.95, 8.95]
        periods = [1.232, 1.23, 1.22, 1.22, 1.24, 1.25, 1.3, 1.34, 1.44]
        level, smaller, larger = gravity._select_equal_period_points(h, periods)
        self.assertAlmostEqual(level, 1.226)
        self.assertAlmostEqual(smaller, 18.35)
        self.assertAlmostEqual(larger, 22.15)

    def test_minimum_with_one_measured_point_on_each_side_is_supported(self):
        level, smaller, larger = gravity._select_equal_period_points(
            list(range(1, 10)), [1.3, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55])
        self.assertGreater(level, 1.2)
        self.assertLess(smaller, 2)
        self.assertGreater(larger, 2)

    def test_fixed_matrix_missing_row_is_rejected_before_calculation(self):
        from common.data_validation import validate
        schema = json.loads((EXP / "schema.json").read_text(encoding="utf-8"))
        self.data["trials"][0] = [None] * 8
        result = validate(schema, self.data)
        self.assertFalse(result["ok"])
        self.assertIn("第1孔", result["missing"][0]["reason"])
        self.data["trials"] = self.data["trials"][1:]
        self.assertFalse(validate(schema, self.data)["ok"])

    def test_existing_average_tolerance_is_unchanged(self):
        self.data["T_avg"] = [sum(row) / len(row) / 10 * 1.029 for row in self.data["trials"]]
        self.assertEqual(gravity._compute(self.data)["T_avg"], self.data["T_avg"])


if __name__ == "__main__":
    unittest.main()
