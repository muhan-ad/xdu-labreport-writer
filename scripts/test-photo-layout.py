"""Exercise the actual runner photo fitter without loading the WASM worker."""
import ast
import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image
from docx import Document
from docx.shared import Cm

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'src/engine/runner.py').read_text(encoding='utf-8-sig'))
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('fit_original_photo','prepare_report_photo')]
namespace = {'hashlib': hashlib, 'io': io}
exec(compile(ast.Module(body=functions, type_ignores=[]), 'runner-photo-fitter', 'exec'), namespace)
fit = namespace['fit_original_photo']
prepare = namespace['prepare_report_photo']


class PhotoLayout(unittest.TestCase):
    def check_photo(self, size, expected_change):
        with tempfile.TemporaryDirectory() as folder:
            photo = io.BytesIO()
            Image.new('RGB', size, '#aaccdd').save(photo, format='PNG')
            content = photo.getvalue()
            other = io.BytesIO()
            Image.new('RGB', (240, 120), '#ddaa88').save(other, format='PNG')
            doc = Document()
            doc.add_paragraph('Original photo and computed results must survive.')
            doc.add_picture(io.BytesIO(content), width=Cm(14))
            doc.add_picture(io.BytesIO(other.getvalue()), width=Cm(14))
            output = Path(folder) / 'report.docx'
            doc.save(output)
            before = output.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            self.assertEqual(fit(output, None), 0)
            with self.assertRaisesRegex(ValueError, '未写入报告'):
                fit(output, 'not-the-photo')
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(fit(output, digest), expected_change)
            fitted = Document(output)
            shape = fitted.inline_shapes[0]
            section = fitted.sections[0]
            self.assertLessEqual(shape.width, section.page_width-section.left_margin-section.right_margin)
            self.assertLessEqual(shape.height, section.page_height-section.top_margin-section.bottom_margin-Cm(2))
            self.assertAlmostEqual(shape.width/shape.height, size[0]/size[1], places=5)
            self.assertEqual(fitted.inline_shapes[1].width, doc.inline_shapes[1].width)
            self.assertEqual(fitted.inline_shapes[1].height, doc.inline_shapes[1].height)
            self.assertEqual([p.text for p in fitted.paragraphs], [p.text for p in doc.paragraphs])
            def media(data):
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    return {n: archive.read(n) for n in archive.namelist() if n.startswith('word/media/')}
            self.assertEqual(media(output.read_bytes()), media(before))
            saved = output.read_bytes()
            self.assertEqual(fit(output, digest), 0)
            self.assertEqual(output.read_bytes(), saved)

    def test_tall_photo_fits_without_cropping(self):
        self.check_photo((400, 2000), 1)

    def test_normal_photo_is_unchanged(self):
        self.check_photo((400, 500), 0)

    def test_landscape_photo_is_unchanged(self):
        self.check_photo((2000, 400), 0)

    def test_jpeg_and_png_without_rotation_keep_original_bytes(self):
        for format in ('JPEG','PNG'):
            data=io.BytesIO()
            Image.new('RGB',(60,40),'red').save(data,format=format)
            self.assertEqual(prepare(data.getvalue()),data.getvalue())

    def test_all_eight_orientation_pixel_mappings(self):
        source=Image.new('RGB',(3,2))
        colors=[(240,20,20),(20,240,20),(20,20,240),(230,220,20),(20,220,230),(220,20,230)]
        source.putdata(colors)
        # Independently enumerated source pixel indices, row-major after orientation.
        cases={1:([0,1,2,3,4,5],(3,2)),2:([2,1,0,5,4,3],(3,2)),
               3:([5,4,3,2,1,0],(3,2)),4:([3,4,5,0,1,2],(3,2)),
               5:([0,3,1,4,2,5],(2,3)),6:([3,0,4,1,5,2],(2,3)),
               7:([5,2,4,1,3,0],(2,3)),8:([2,5,1,4,0,3],(2,3))}
        for orientation,(indices,size) in cases.items():
            with self.subTest(orientation=orientation):
                exif=Image.Exif();exif[274]=orientation
                raw=io.BytesIO();source.save(raw,format='PNG',exif=exif)
                result=Image.open(io.BytesIO(prepare(raw.getvalue())))
                self.assertEqual(result.size,size)
                self.assertEqual([result.getpixel((x,y)) for y in range(size[1]) for x in range(size[0])],[colors[i] for i in indices])
                self.assertIn(result.getexif().get(274,1),(None,1))

    def test_webp_normalizes_losslessly_to_word_supported_png(self):
        source=Image.new('RGBA',(60,40),(30,100,180,128));data=io.BytesIO()
        source.save(data,format='WEBP',lossless=True)
        original=data.getvalue();prepared=prepare(original)
        result=Image.open(io.BytesIO(prepared))
        self.assertEqual(result.format,'PNG')
        self.assertEqual(result.size,source.size)
        self.assertEqual(result.tobytes(),source.tobytes())
        self.assertEqual(data.getvalue(),original)

    def test_corrupt_photo_is_rejected(self):
        with self.assertRaises(Exception):prepare(b'broken-photo')


if __name__ == '__main__':
    unittest.main()
