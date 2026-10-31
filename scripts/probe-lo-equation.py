"""Create one disposable synthetic-report copy for a LibreOffice compatibility probe."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

source=Path('artifacts/verification/report-regression-0.138.0/e11a3a9cc7ae.docx')
target=Path('artifacts/verification/libreoffice-render-0.138.0/probe-fullwidth.docx')
math='http://schemas.openxmlformats.org/officeDocument/2006/math'
with ZipFile(source) as zin, ZipFile(target,'w') as zout:
    for info in zin.infolist():
        content=zin.read(info.filename)
        if info.filename=='word/document.xml':
            root=etree.fromstring(content);count=0
            for equation in root.findall('.//{%s}oMath'%math):
                texts=equation.findall('.//{%s}t'%math)
                if texts and texts[0].text=='=':
                    texts[0].text='＝';count+=1
            content=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
        zout.writestr(info,content)
print('changed equations',count)
