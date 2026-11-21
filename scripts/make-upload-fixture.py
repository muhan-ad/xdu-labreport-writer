import io
import os
import zipfile

if os.environ.get('UPLOAD_PHOTO_COMPRESSION') == '1':
    from docx import Document
    from docx.shared import Cm
    from PIL import Image, ImageDraw

    image = Image.effect_noise((3000, 2200), 15).convert('RGB')
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((150, 160, 2850, 2040), fill='white')
    for x in range(180, 2850, 32):
        drawing.line((x, 170, x, 2030), fill='#65abb3', width=1)
    for y in range(180, 2040, 40):
        drawing.line((160, y, 2840, y), fill='#65abb3', width=1)
        drawing.text((190, y + 8), '0.625   0.640   79.998   20.140', fill='#1b2022')
    photo = io.BytesIO()
    image.save(photo, 'JPEG', quality=100, subsampling=0)
    photo.seek(0)
    chart = io.BytesIO()
    image.crop((160, 170, 400, 370)).save(chart, 'PNG')
    chart.seek(0)
    doc = Document()
    doc.add_paragraph('UPLOAD_TEST_MARKER')
    doc.add_picture(photo, width=Cm(14))
    doc.add_picture(chart, width=Cm(5))
    doc.save('artifacts/verification/upload-source.docx')
    raise SystemExit(0)

with zipfile.ZipFile('artifacts/verification/upload-source.docx','w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>UPLOAD_TEST_MARKER</w:t></w:r></w:p></w:body></w:document>')
 z.writestr('word/padding.bin',os.urandom(110000))
