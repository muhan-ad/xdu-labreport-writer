"""Mobile bridge around the original generators, with isolated jobs and no host Python."""
import os, sys, json, shutil, tempfile, importlib.util, contextlib, io, zipfile, base64, hashlib, random, re
from pathlib import Path
BASE=Path('/lab/source')
SOURCES=json.loads(Path('/lab/report-sources.json').read_text())
_TORSION_SOURCE='扭摆法测量钢丝切变模量/generate.py'
_TORSION_OLD=r'r"\frac{0.01}{\sqrt{3}} \approx " + format_number(B_T, sig_figs=4)'
_TORSION_FIXED=r'r"\frac{" + format_number(DELTA_TIMER, sig_figs=8) + r"}{\sqrt{3}} \approx " + format_number(B_T, sig_figs=4)'
if SOURCES.get(_TORSION_SOURCE,'').count(_TORSION_OLD)==2:
    # Compatibility overlay in memory only; the verified signed bundle remains unchanged.
    SOURCES[_TORSION_SOURCE]=SOURCES[_TORSION_SOURCE].replace(_TORSION_OLD,_TORSION_FIXED)
_RLC_SOURCE='RLC电路的稳态特性研究实验/generate.py'
_RLC_OLD='f0 = round(1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0, 3)'
_RLC_FIXED='f0 = 1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0'
if SOURCES.get(_RLC_SOURCE,'').count(_RLC_OLD)==1:
    SOURCES[_RLC_SOURCE]=SOURCES[_RLC_SOURCE].replace(_RLC_OLD,_RLC_FIXED)
_SOLENOID_SOURCE='直螺线管磁场分布的测量/generate.py'
_SOLENOID_OLD=(
    '"dm1_cm": (dm1_cm_list[i], u_dm_cm),',
    '"dm2_cm": (dm2_cm_list[i], u_dm_cm),',
)
_solenoid=SOURCES.get(_SOLENOID_SOURCE,'')
if all(_solenoid.count(line)==1 for line in _SOLENOID_OLD):
    for line in _SOLENOID_OLD:
        _solenoid=_solenoid.replace(line,line.replace('u_dm_cm)', 'u_dm_single_mm / 10.0)'))
    anchor='        "ot": _ot_rkb,'
    extra='\n        "u_A_RKb": u_A_RKb, "u_B_RKb": u_B_RKb, "u_RKb": u_RKb,\n        "u_B_center": u_B_center, "u_B_center_A": u_B_center_A, "u_B_center_B": u_B_center_B,\n        "u_dm_single_cm": u_dm_single_mm / 10.0, "u_dm_mean_cm": u_dm_center_cm,'
    if _solenoid.count(anchor)==1 and '"u_A_RKb": u_A_RKb' not in _solenoid:
        _solenoid=_solenoid.replace(anchor,anchor+extra)
    SOURCES[_SOLENOID_SOURCE]=_solenoid
CATALOG=json.loads(Path('/lab/catalog.json').read_text())['experiments']
BY_ID={e['id']:e for e in CATALOG}
def validate_sound_phase(exp,data):
    if exp['sourceId']=='直螺线管磁场分布的测量' and any(line in SOURCES.get(_SOLENOID_SOURCE,'') for line in _SOLENOID_OLD):
        raise ValueError('当前实验数据包的标尺不确定度计算不完整，请恢复内置实验数据或更新数据包')
    if exp['sourceId']=='RLC电路的稳态特性研究实验' and _RLC_OLD in SOURCES.get(_RLC_SOURCE,''):
        raise ValueError('当前实验数据包的谐振频率计算不完整，请恢复内置实验数据或更新数据包')
    if exp['sourceId']=='扭摆法测量钢丝切变模量' and _TORSION_OLD in SOURCES.get(_TORSION_SOURCE,''):
        raise ValueError('当前实验数据包的计时限差公式不完整，请恢复内置实验数据或更新数据包')
    if exp['sourceId']=='低电阻的测量' and '# MOBILE_LOW_RESISTANCE_V1' not in SOURCES.get(exp['sourceId']+'/generate.py',''):
        raise ValueError('当前实验数据包的低电阻不确定度计算尚未修正，请恢复内置实验数据或更新数据包')
    if exp['sourceId'] not in ('声速的测量（空气）','声速的测量（水中）'):return
    value=data.get('phase_step')
    if isinstance(value,bool) or value not in (0.5,1.0):raise ValueError('请选择位相法相邻记录点间隔')
    if '# MOBILE_SOUND_PHASE_V1' not in SOURCES.get(exp['sourceId']+'/generate.py',''):
        raise ValueError('当前实验数据包不支持所选位相间隔，请恢复内置实验数据或更新数据包')
    if '# MOBILE_SOUND_AVG_ERROR_V1' not in SOURCES.get(exp['sourceId']+'/generate.py',''):
        raise ValueError('当前实验数据包尚未修正平均声速误差，请恢复内置实验数据或更新数据包')
    if exp['sourceId']=='声速的测量（水中）' and any(isinstance(data.get(k),list) and len(data[k])==10 for k in ('L1','L2')) and '# MOBILE_SOUND_WATER_LENGTH_V1' not in SOURCES.get(exp['sourceId']+'/generate.py',''):
        raise ValueError('当前实验数据包不支持水中声速 10 组数据，请恢复内置实验数据或更新数据包')
BASE.mkdir(parents=True,exist_ok=True)
for name,text in SOURCES.items():
    target=BASE/name
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(text,encoding='utf-8')
sys.path.insert(0,str(BASE))
import matplotlib
matplotlib.use('Agg')
def _isolated_plot_style(function):
    """Original generators may change global rcParams; never carry them to another job."""
    import functools
    @functools.wraps(function)
    def run(*args,**kwargs):
        with matplotlib.rc_context():
            return function(*args,**kwargs)
    return run
from matplotlib import font_manager
for alias in ('SimHei','Microsoft YaHei','Arial Unicode MS','Lab Maker SC'):
    font_manager.fontManager.ttflist.append(font_manager.FontEntry(fname='/lab/LabMakerSansSC.ttf',name=alias,weight=400))
from common.data_io import load_data
from common.docx_omml import stats as math_stats
from common.docx_report import DocxReportWriter as OriginalWriter

def chart_width(config):
    import math
    value=config.get('widthCm',14.0)
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 4<=value<=20:
        raise ValueError('图片宽度须为 4–20 cm')
    return float(value)

def prepare_report_photo(content):
    """Keep stored originals; normalize only the copy embedded in Word."""
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(content)) as image:
        if image.format not in ('JPEG', 'PNG', 'WEBP'):
            raise ValueError('原始照片仅支持 JPEG、PNG 或 WebP')
        orientation=image.getexif().get(274,1)
        if image.format in ('JPEG','PNG') and orientation in (None,1):
            # PNG EXIF lookup may load image data; verify a fresh reader.
            with Image.open(io.BytesIO(content)) as verifier:verifier.verify()
            return content
        normalized=ImageOps.exif_transpose(image)
        try:
            normalized.load()
            normalized.info.clear()
            output=io.BytesIO()
            normalized.save(output,format='PNG')
            return output.getvalue()
        finally:normalized.close()

def fit_original_photo(path, digest):
    """Keep original image bytes; constrain only its displayed size to one page."""
    if not digest:return 0
    from docx import Document
    from docx.shared import Cm
    from docx.oxml.ns import qn
    doc=Document(path)
    # Leave space for the existing record heading, caption and paragraph spacing.
    width=min(int(s.page_width-s.left_margin-s.right_margin) for s in doc.sections)
    height=min(int(s.page_height-s.top_margin-s.bottom_margin-Cm(2)) for s in doc.sections)
    if width<=0 or height<=0:raise ValueError('报告页面可用尺寸无效')
    changed=0;matched=0
    for shape in doc.inline_shapes:
        blips=shape._inline.xpath('.//a:blip')
        if not blips:continue
        rid=blips[0].get(qn('r:embed'));part=doc.part.related_parts.get(rid)
        if part is None or hashlib.sha256(part.blob).hexdigest()!=digest:continue
        matched+=1
        original_width,original_height=int(shape.width),int(shape.height)
        if original_width<=0 or original_height<=0:raise ValueError('原始照片显示尺寸无效')
        scale=min(1.0,width/original_width,height/original_height)
        if scale<1:
            shape.width=max(1,int(original_width*scale));shape.height=max(1,int(original_height*scale));changed+=1
    if not matched:raise ValueError('原始数据照片未写入报告，请检查照片后重新生成')
    if changed:doc.save(path)
    return changed

def diagnose_runtime():
    """Check bundled source usability without opening or changing user records."""
    problems=[];scripts=0;templates=0
    def issue(path,reason):problems.append({'path':str(path),'reason':str(reason)[:200]})
    for name,text in SOURCES.items():
        if not name.endswith('.py'):continue
        try:compile(text,name,'exec');scripts+=1
        except Exception as error:issue(name,'脚本无法编译：'+type(error).__name__)
    seen=set()
    for exp in CATALOG:
        source=exp.get('sourceId','');eid=exp.get('id','')
        if not eid or eid in seen:issue('catalog.json','实验编号缺失或重复')
        seen.add(eid)
        for filename in ('generate.py','schema.json','variants.json','rag/原理.md'):
            name=source+'/'+filename
            if name not in SOURCES or not SOURCES[name].strip():issue(name,'资源缺失或为空');continue
            if filename=='schema.json':
                try:
                    schema=json.loads(SOURCES[name])
                    if not isinstance(schema,dict) or schema.get('groups')!=exp['schema']['groups']:raise ValueError()
                except Exception:issue(name,'录入字段与实验目录不一致')
            if filename=='variants.json':
                try:
                    variants=json.loads(SOURCES[name])
                    if not isinstance(variants,dict) or not variants:raise ValueError()
                    if not any(isinstance(v,list) and v and all(isinstance(t,str) and t.strip() for t in v) for v in variants.values()):raise ValueError()
                    templates+=1
                except Exception:issue(name,'变体模板格式无效')
    if not CATALOG:issue('catalog.json','实验目录为空')
    # Exercise the actual document/math/image libraries in memory only.
    try:
        from docx import Document
        from common.docx_omml import latex_to_omml
        from PIL import Image
        doc=Document();doc.add_paragraph('运行环境自检');stream=io.BytesIO();doc.save(stream)
        if not zipfile.is_zipfile(io.BytesIO(stream.getvalue())) or not latex_to_omml(r'x^2'):raise ValueError()
        image=Image.new('RGB',(1,1),'white');out=io.BytesIO();image.save(out,format='PNG')
        font=font_manager.get_font('/lab/LabMakerSansSC.ttf')
        required={ord(c) for content in SOURCES.values() for c in content if '\u4e00'<=c<='\u9fff'}
        missing=required-set(font.get_charmap())
        if missing:issue('LabMakerSansSC.ttf','报告字体缺少所需汉字：'+str(len(missing))+' 个')
    except Exception as error:issue('report-runtime','文档、公式、图像或字体组件不可用：'+type(error).__name__)
    return json.dumps({'complete':not problems,'experiments':len(CATALOG),'scripts':scripts,'templates':templates,'problems':problems},ensure_ascii=False)

class ReportCopySources:
    """Read final OOXML while retaining the exact LaTeX used for each generated math node.
    No document markup is added or rewritten. Unknown formula provenance is explicit.
    """
    def __init__(self):
        import common.docx_omml as math_module
        import common.docx_report as writer_module
        self.math,self.writer=math_module,writer_module
        self.original=math_module.latex_to_omml;self.writer_original=writer_module.latex_to_omml
        self.sources={}
    @staticmethod
    def signature(node):
        ignored={'ctrlPr','oMathPr'}
        def tree(n):
            if n.tag.rsplit('}',1)[-1] in ignored or n.tag=='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr':return None
            return (n.tag,tuple(sorted(n.attrib.items())),n.text if n.tag.rsplit('}',1)[-1]=='t' else None,tuple(v for child in n if (v:=tree(child)) is not None))
        return repr(tree(node))
    def install(self):
        from lxml import etree
        def convert(latex):
            out=self.original(latex)
            if out:
                formula=str(latex).strip()
                for delimiter in ('$$','$'):
                    if formula.startswith(delimiter) and formula.endswith(delimiter):formula=formula[len(delimiter):-len(delimiter)].strip();break
                try:self.sources.setdefault(self.signature(etree.fromstring(out.encode())),formula)
                except Exception:pass
            return out
        self.math.latex_to_omml=convert;self.writer.latex_to_omml=convert
    def restore(self):
        self.math.latex_to_omml=self.original;self.writer.latex_to_omml=self.writer_original
    def extract(self,output,heading_texts):
        from lxml import etree
        with zipfile.ZipFile(output) as archive:root=etree.fromstring(archive.read('word/document.xml'))
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
        def text(node):
            local=node.tag.rsplit('}',1)[-1]
            if node.tag=='{'+ns['m']+'}oMath':
                formula=self.sources.get(self.signature(node))
                if formula is None:raise ValueError('此段公式源文未核实，请重新生成报告后核对')
                return '$'+formula+'$'
            if node.tag=='{'+ns['w']+'}t':return node.text or ''
            if local in ('tab','br'):return '\t' if local=='tab' else '\n'
            if local=='tc':return '\n'.join(text(c).strip() for c in node if c.tag.rsplit('}',1)[-1] in ('p','tbl'))
            if local=='tr':return '\t'.join(text(c) for c in node if c.tag=='{'+ns['w']+'}tc')+'\n'
            return ''.join(text(c) for c in node)
        blocks=list(root.find('w:body',ns));markers=[]
        for i,node in enumerate(blocks):
            plain=''.join(node.xpath('.//w:t/text()',namespaces=ns)).strip()
            if node.tag=='{'+ns['w']+'}p' and plain in heading_texts:markers.append((i,plain,section_name(plain)))
        sections,issues={},{}
        for scope,patterns in [('analysis',[r'结果.*分析',r'数据.*处理',r'实验结果']),('quiz',[r'^思考题$'])]:
            chosen=next(((i,title,name) for pattern in patterns for i,title,name in markers if re.search(pattern,name)),None)
            if not chosen:issues[scope]='当前报告没有对应章节';continue
            start,title,name=chosen;end=next((i for i,_,_ in markers if i>start),len(blocks))
            try:
                result='\n'.join(text(node).strip() for node in blocks[start:end] if node.tag.rsplit('}',1)[-1] in ('p','tbl')).strip()
                if len(result)>20000:raise ValueError('此章节超过 20000 字，无法一次润色')
                if not result:raise ValueError('此章节没有可核实的正文')
                sections[scope]=result
            except ValueError as error:issues[scope]=str(error)
        formulas=root.xpath('//m:oMath',namespaces=ns)
        missing=sum(self.signature(node) not in self.sources for node in formulas)
        return sections,issues,{'total':len(formulas),'unmapped':missing}

def section_name(value):
    name=re.sub(r'^[一二三四五六七八九十0-9、.（）()\s]+','',str(value)).strip()
    return {'问题讨论':'思考题','课后思考题':'思考题','实验误差分析':'误差分析','实验误差来源':'误差分析'}.get(name,name)

def section_filter(disabled):
    # Keep all generation calculations and object-returning methods unchanged. Remove only
    # complete heading ranges immediately before writing, including nested paragraphs/tables.
    class FilteredWriter(OriginalWriter):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs);self._mobile_markers=[];self._mobile_filtered=False;self._mobile_section=''
        def add_heading(self,text,level=1):
            if level==1:self._mobile_section=section_name(text)
            paragraph=super().add_heading(text,level)
            paragraph.paragraph_format.keep_with_next=True
            self._mobile_markers.append((paragraph._p,level,section_name(text)))
            return paragraph
        def add_paragraph(self,text,bold=False):
            paragraph=super().add_paragraph(text,bold)
            if bold and self._mobile_section=='思考题' and paragraph is not None:paragraph.paragraph_format.keep_with_next=True
            return paragraph
        def _style_table(self,table,ncols,col_widths):
            widths=super()._style_table(table,ncols,col_widths)
            from docx.oxml import OxmlElement
            from docx.oxml.ns import qn
            for index,row in enumerate(table.rows):
                properties=row._tr.get_or_add_trPr()
                if properties.find(qn('w:cantSplit')) is None:properties.append(OxmlElement('w:cantSplit'))
                if index==0:
                    if properties.find(qn('w:tblHeader')) is None:properties.append(OxmlElement('w:tblHeader'))
                    for cell in row.cells:
                        for paragraph in cell.paragraphs:paragraph.paragraph_format.keep_with_next=True
            return widths
        def _save_tmp(self):
            if not self._mobile_filtered:
                body=self._doc._element.body;elements=list(body);remove=set()
                # A few questions are assembled from runs and inline equations, so they
                # cannot be identified in add_paragraph until their content is complete.
                from docx.oxml import OxmlElement
                from docx.oxml.ns import qn
                heading_nodes={node:(level,name) for node,level,name in self._mobile_markers}
                quiz=False
                for node in elements:
                    marker=heading_nodes.get(node)
                    if marker and marker[0]==1:quiz=marker[1]=='思考题'
                    if quiz and node.tag==qn('w:p'):
                        text=''.join(node.itertext()).strip()
                        if re.match(r'^\d+\s*[.、．)）]',text) and text.endswith(('?','？')):
                            properties=node.get_or_add_pPr()
                            if properties.find(qn('w:keepNext')) is None:properties.append(OxmlElement('w:keepNext'))
                markers=[(elements.index(node),level,name) for node,level,name in self._mobile_markers if node in elements]
                for i,(start,level,name) in enumerate(markers):
                    if name not in disabled:continue
                    end=next((position for position,next_level,_ in markers[i+1:] if next_level<=level),len(elements)-1)
                    remove.update(range(start,end))
                for i in sorted(remove,reverse=True):body.remove(elements[i])
                self._mobile_filtered=True
            super()._save_tmp()
    return FilteredWriter

os.makedirs('/lab/jobs',exist_ok=True)
def caption_text(node):
    local=node.tag.rsplit('}',1)[-1]
    if local=='t':return node.text or ''
    if local in ('sSub','sSup','sSubSup'):
        values={child.tag.rsplit('}',1)[-1]:caption_text(child) for child in node}
        return values.get('e','')+('_{'+values['sub']+'}' if 'sub' in values else '')+('^{'+values['sup']+'}' if 'sup' in values else '')
    text=''.join(caption_text(child) for child in node)
    if local=='r':
        alignment=node.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr/{http://schemas.openxmlformats.org/wordprocessingml/2006/main}vertAlign')
        if alignment is not None:
            kind=alignment.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
            if kind in ('subscript','superscript'):text=('_' if kind=='subscript' else '^')+'{'+text+'}'
    return text

def plot_helper(name):
    spec=importlib.util.spec_from_file_location('_mobile_'+name,'/lab/'+name+'.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def plot_label(value):
    sub=str.maketrans('₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ','0123456789+-=()aeoxhklmnpst')
    sup=str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻','0123456789+-')
    pieces=re.split(r'(\$[^$]*\$)',value)
    for i,piece in enumerate(pieces):
        if piece.startswith('$') and piece.endswith('$'):continue
        piece=re.sub(r'([A-Za-zΑ-Ωα-ω])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ]+)',lambda m:'$'+m[1]+'_{'+m[2].translate(sub)+'}$',piece)
        piece=re.sub(r'([A-Za-z])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)',lambda m:'$'+m[1]+'^{'+m[2].translate(sup)+'}$',piece)
        piece=re.sub(r'([A-Za-z])_([A-Za-z0-9]+)',lambda m:'$'+m[1]+'_{'+m[2]+'}$',piece)
        pieces[i]=piece
    return ''.join(pieces)

def render_custom_caption(path,title):
    from docx import Document
    caption=str(title).strip().splitlines()[0].split('。',1)[0].split('注：',1)[0].strip() or '图表'
    document=Document(path);writer=OriginalWriter(str(Path(path).with_name('caption-helper.docx')))
    for paragraph in document.paragraphs:
        previous=paragraph._p.getprevious()
        if paragraph.text!=caption or previous is None or not previous.xpath('.//a:blip'):continue
        paragraph.clear()
        for part in re.split(r'(\$[^$]+\$)',plot_label(caption)):
            if part.startswith('$') and part.endswith('$') and len(part)>2:writer._append_math(paragraph,part[1:-1],display=False,size_pt=10.5)
            elif part:writer._add_text_runs(paragraph,part,'宋体',10.5)
    document.save(path)

def draw_custom(exp,data,chart,folder):
    import math
    if not isinstance(chart,dict) or chart.get('kind') not in ('scatter','line','fit','bar') or not isinstance(chart.get('embed'),bool):raise ValueError('绘图配置格式无效')
    chart_width(chart)
    for key in ('x','y','title','xlabel','ylabel','caption','section'):
        if not isinstance(chart.get(key),str) or len(chart[key])>200:raise ValueError('绘图配置格式无效')
    fields={f['key']:f for g in exp['schema']['groups'] for f in g['fields']}
    def values(selector):
        match=re.fullmatch(r'(.+)\[(row:)?(\d+)\]',selector)
        key=match[1] if match else selector;field=fields.get(key)
        if not field or field['type'] not in ('array','matrix'):raise ValueError('绘图字段不属于当前实验')
        raw=data.get(key);label=field['label']
        if not isinstance(raw,list):raise ValueError('所选字段不是数据列')
        if match:
            if field['type']!='matrix':raise ValueError('绘图字段不是表格')
            index=int(match[3]);kind='rowLabels' if match[2] else 'colLabels'
            labels=field.get(kind,[]);label+=' · '+(labels[index] if index<len(labels) else f'第 {index+1} '+('行' if match[2] else '列'))
            if not match[2] and field.get('colsFrom'):
                driver=fields.get(field['colsFrom'],{});positions=data.get(field['colsFrom'],[])
                position=positions[index] if isinstance(positions,list) and index<len(positions) else None
                point=f"{driver.get('label',field['colsFrom'])}={position:.5g} {driver.get('unit','')}" if isinstance(position,(int,float)) and not isinstance(position,bool) and math.isfinite(position) else f'第 {index+1} 列（位置待填）'
                label=field['label']+' · '+point
            if match[2]:
                if index>=len(raw) or not isinstance(raw[index],list):raise ValueError('表格行不存在')
                raw=raw[index]
            else:
                if any(not isinstance(row,list) or index>=len(row) for row in raw):raise ValueError('表格列长度不正确')
                raw=[row[index] for row in raw]
        elif field['type']!='array':raise ValueError('请选择表格中的具体一行或一列')
        if field.get('unit'):label+=' / '+field['unit']
        return raw,plot_label(label)
    x,xlabel=values(chart['x']);y,ylabel=values(chart['y'])
    if len(x)!=len(y):raise ValueError('X 和 Y 字段长度不匹配')
    pairs=[]
    for i,(a,b) in enumerate(zip(x,y),1):
        if a is None and b is None:continue
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in (a,b)):raise ValueError(f'第 {i} 行的 X/Y 数据缺失或不是有限数值')
        pairs.append((a,b))
    if len(pairs)<2:raise ValueError('至少需要两组完整的 X/Y 数据')
    if chart['kind']=='fit' and len({a for a,b in pairs})<2:raise ValueError('线性拟合需要至少两个不同的 X 值')
    folder.mkdir(parents=True,exist_ok=True)
    (folder/'data.json').write_text(json.dumps({'x':[a for a,b in pairs],'y':[b for a,b in pairs]},allow_nan=False))
    (folder/'schema.json').write_text(json.dumps({'groups':[{'fields':[{'key':'x','type':'array','label':xlabel},{'key':'y','type':'array','label':ylabel}]}]},ensure_ascii=False))
    image,title=plot_helper('chart_preview').generate_chart(str(folder),'x','y',chart['kind'],plot_label(chart['title']),plot_label(chart['xlabel']),plot_label(chart['ylabel']),str(folder/'custom.png'),str(BASE))
    return image,plot_label(chart['caption'] or title)

def draw_official(exp,data,selection,folder):
    if not isinstance(selection,dict) or not isinstance(selection.get('preset'),str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,39}',selection['preset']):raise ValueError('预设配置无效')
    from common.official_charts import chart_specs,render_specs
    specs=chart_specs(exp['sourceId'],data,str(BASE),selection['preset'])
    folder.mkdir(parents=True,exist_ok=True)
    # Original report generators set global plotting styles. Keep preset previews and
    # report inserts identical, and restore the caller's style after this rendering.
    import matplotlib
    with matplotlib.rc_context():
        matplotlib.rcdefaults()
        return render_specs(specs,str(folder/'official.png'),str(BASE))

@_isolated_plot_style
def generate_chart_preview(raw):
    request=json.loads(raw);exp=BY_ID.get(request.get('experimentId'))
    if not exp or not isinstance(request.get('data'),dict):raise ValueError('绘图实验或数据无效')
    job=Path(tempfile.mkdtemp(prefix='job-',dir='/lab/jobs'))
    try:
        selection=(request.get('options') or {}).get('officialCharts')
        if selection is not None:
            images=draw_official(exp,request['data'],selection,job/'plot')
            return json.dumps({'job':str(job),'name':'实验预设图组','formulaCount':0,'sections':{},'charts':[{'name':image['caption'],'path':image['path']} for image in images],'log':''},ensure_ascii=False)
        image,title=draw_custom(exp,request['data'],(request.get('options') or {}).get('chart'),job/'plot')
        return json.dumps({'job':str(job),'name':title,'formulaCount':0,'sections':{},'charts':[{'name':title,'path':image}],'log':''},ensure_ascii=False)
    except BaseException:shutil.rmtree(job,ignore_errors=True);raise
    finally:
        import matplotlib.pyplot as plt
        plt.close('all')

@_isolated_plot_style
def generate_ai_plot_preview(raw):
    """Internal adapter; UI execution awaits the dedicated Worker isolation review."""
    request=json.loads(raw);exp=BY_ID.get(request.get('experimentId'))
    if not exp or not isinstance(request.get('data'),dict):raise ValueError('绘图实验或数据无效')
    job=Path(tempfile.mkdtemp(prefix='job-',dir='/lab/jobs'))
    try:
        result=plot_helper('ai_plot').render(request.get('code'),request['data'],job/'plot')
        return json.dumps({'job':str(job),'name':result['name'],'formulaCount':0,'sections':{},'charts':result['images'],'log':result['log']},ensure_ascii=False)
    except BaseException:
        shutil.rmtree(job,ignore_errors=True)
        raise


@_isolated_plot_style
def calculate_context(raw):
    """Read-only numerical context from the same original calculation as reports."""
    request=json.loads(raw);exp=BY_ID.get(request.get('experimentId'))
    if not exp or not isinstance(request.get('data'),dict):raise ValueError('计算实验或数据无效')
    validate_sound_phase(exp,request['data'])
    job=Path(tempfile.mkdtemp(prefix='job-',dir='/lab/jobs'))
    previous=os.getcwd();previous_path=list(sys.path)
    previous_env={k:v for k,v in os.environ.items() if k.startswith('LAB_')}
    try:
        for key in list(os.environ):
            if key.startswith('LAB_'):del os.environ[key]
        for entry in CATALOG:shutil.copytree(BASE/entry['sourceId'],job/entry['sourceId'])
        target=job/exp['sourceId']
        (target/'data.json').write_text(json.dumps(request['data'],ensure_ascii=False,allow_nan=False))
        os.chdir(target)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            if exp['sourceId']=='电容与高电阻的测量':
                spec=importlib.util.spec_from_file_location('_mobile_context',target/'generate.py')
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                values=module.calculation_context(load_data(str(target/'data.json')))
            else:
                from common.calculation_context import calculate
                values=calculate(target)
        if not isinstance(values,dict):raise ValueError('计算结果格式无效')
        # Keep exact numerical values. Display rounding must never feed back into calculations.
        result={'experimentId':exp['id'],'sourceId':exp['sourceId'],'values':values}
        encoded=json.dumps(result,ensure_ascii=False,allow_nan=False)
        if len(encoded.encode())>400000:raise ValueError('计算上下文过大')
        return encoded
    finally:
        import matplotlib.pyplot as plt
        plt.close('all');os.chdir(previous);sys.path[:]=previous_path
        for key in list(os.environ):
            if key.startswith('LAB_'):del os.environ[key]
        os.environ.update(previous_env)
        shutil.rmtree(job,ignore_errors=True)


@_isolated_plot_style
def generate_report(raw):
    request=json.loads(raw)
    exp=BY_ID.get(request.get('experimentId'))
    if not exp:raise ValueError('未找到对应实验')
    if not isinstance(request.get('data'),dict):raise ValueError('测量数据格式错误')
    validate_sound_phase(exp,request['data'])
    options=request.get('options') or {}
    if not isinstance(options,dict):raise ValueError('报告配置格式错误')
    if len(json.dumps(options,ensure_ascii=False).encode())>400000:raise ValueError('报告配置过大')
    before=math_stats();logs=io.StringIO()
    job=Path(tempfile.mkdtemp(prefix='job-',dir='/lab/jobs'))
    previous=os.getcwd();previous_path=list(sys.path);previous_env={k:v for k,v in os.environ.items() if k.startswith('LAB_')}
    completed=False
    variants_loader=None;variants_module=None;variant_applied=set();variant_edits={};variant_additions={};variant_appended=set()
    copy_capture=ReportCopySources()
    heading_texts=[];original_heading=OriginalWriter.add_heading
    def tracked_heading(writer,text,level=1):
        paragraph=original_heading(writer,text,level)
        if level==1:heading_texts.append(paragraph.text.strip())
        return paragraph
    OriginalWriter.add_heading=tracked_heading
    for key in list(os.environ):
        if key.startswith('LAB_'):del os.environ[key]
    try:
        copy_capture.install()
        # Sibling experiment wrappers remain available; immutable common modules are shared.
        for entry in CATALOG:shutil.copytree(BASE/entry['sourceId'],job/entry['sourceId'])
        target=job/exp['sourceId'];(target/'data.json').write_text(json.dumps(request['data'],ensure_ascii=False,allow_nan=False))
        (job/'job.json').write_text(json.dumps(options,ensure_ascii=False,allow_nan=False))
        os.chdir(job);os.environ['LAB_JOB_INPUT']=str(job/'job.json')
        profile=request.get('profile') or {}
        for name,key in [('NAME','name'),('ID','studentId'),('CLASS','className')]:os.environ['LAB_STUDENT_'+name]=str(profile.get(key,'') or '')[:100]
        os.environ['LAB_STUDENT_DATE']=str(request.get('date',''))[:10]
        photo=request.get('photoBase64');photo_digest=None
        if photo:
            if len(photo)>12*1024*1024:raise ValueError('原始照片超过限制')
            content=base64.b64decode(photo,validate=True)
            if len(content)>8*1024*1024:raise ValueError('原始照片超过 8 MB')
            original_content=content
            content=prepare_report_photo(content)
            if content!=original_content:logs.write('[提示] 报告照片已按显示方向转换为兼容图片，本机原图保留。\n')
            (job/'photo.png').write_bytes(content);os.environ['LAB_DATA_PHOTO']=str(job/'photo.png');photo_digest=hashlib.sha256(content).hexdigest()
        random.seed(request.get('seed',None))
        spec=importlib.util.spec_from_file_location('_mobile_generator',target/'generate.py');module=importlib.util.module_from_spec(spec)
        if options.get('variantEdits') or options.get('customVariants'):
            edit_spec=importlib.util.spec_from_file_location('_mobile_variant_edits','/lab/variant_edits.py')
            edit_module=importlib.util.module_from_spec(edit_spec);edit_spec.loader.exec_module(edit_module)
            variant_edits=edit_module.checked_edits(options.get('variantEdits'))
            variant_additions=edit_module.checked_additions(options.get('customVariants'))
            import common.variants as variants_module
            variants_loader=variants_module.load_variants
            variants_module.load_variants=edit_module.edited_loader(variants_loader,variant_edits,variant_applied,job,variant_additions,variant_appended)
        output=job/'report.docx'
        with contextlib.redirect_stdout(logs),contextlib.redirect_stderr(logs):
            spec.loader.exec_module(module)
            module.DocxReportWriter=section_filter(set(options.get('disabledSections') or []))
            data=load_data(str(target/'data.json'))
            module._generate_docx(data,str(output))
        if variant_edits and variant_applied!={(section,index) for section,items in variant_edits.items() for index in items}:raise ValueError('部分变体未在当前报告中找到，未生成报告')
        if variant_additions and variant_appended!={(section,row['id']) for section,rows in variant_additions.items() for row in rows}:raise ValueError('部分自建候选未在当前报告中找到，未生成报告')
        if not output.exists():raise ValueError('报告未生成：'+logs.getvalue()[-1500:])
        custom_charts=options.get('customCharts',[])
        if not isinstance(custom_charts,list) or len(custom_charts)>8:raise ValueError('最多配置八张自定义图表')
        for i,chart in enumerate(custom_charts):
            if not isinstance(chart,dict):raise ValueError('绘图配置格式无效')
            if chart.get('embed') is not True:continue
            image,title=draw_custom(exp,request['data'],chart,job/f'custom-{i}')
            from docx import Document
            present={p.text.strip() for p in Document(output).paragraphs}
            headings=set(heading_texts)&present
            if chart['section'] not in {section_name(t) for t in headings}:raise ValueError('报告没有章节“'+chart['section']+'”，请选择实际章节')
            inserter=plot_helper('insert_chart')
            # The original writer formats headings directly (not Word's Heading 1 style).
            # Track its declared levels to avoid treating numbered subheadings as chapters.
            inserter._is_section_header=lambda text,target:section_name(text)==chart['section']
            inserter._is_any_section_header=lambda text:text.strip() in headings
            inserter.insert_chart(str(output),image,chart['section'],chart_width(chart),title)
            render_custom_caption(str(output),title)
        official=options.get('officialCharts')
        if official is not None:
            if not isinstance(official,dict) or not isinstance(official.get('embed'),bool):raise ValueError('预设配置无效')
            chart_width(official)
            if official['embed']:
                section=official.get('section')
                if not isinstance(section,str) or not section or len(section)>100:raise ValueError('预设插入章节无效')
                from docx import Document
                present={p.text.strip() for p in Document(output).paragraphs}
                headings=set(heading_texts)&present
                if section not in {section_name(t) for t in headings}:raise ValueError('报告没有章节“'+section+'”，请选择实际章节')
                images=draw_official(exp,request['data'],official,job/'official')
                inserter=plot_helper('insert_chart')
                inserter._is_section_header=lambda text,target:section_name(text)==section
                inserter._is_any_section_header=lambda text:text.strip() in headings
                # The original inserter appends at the chapter end, preserving guide order.
                for image in images:
                    inserter.insert_chart(str(output),image['path'],section,chart_width(official),image['caption'])
                    render_custom_caption(str(output),image['caption'])
        ai_images=request.get('aiPlotImages')
        if ai_images is not None and request.get('aiPlotImage') is not None:raise ValueError('AI 图表配置重复')
        if ai_images is None:ai_images=[request['aiPlotImage']] if request.get('aiPlotImage') is not None else []
        if not isinstance(ai_images,list) or len(ai_images)>8:raise ValueError('AI 图组最多八张')
        ai_total_bytes=0
        for ai_index,ai_image in enumerate(ai_images):
            if not isinstance(ai_image,dict) or not isinstance(ai_image.get('base64'),str) or len(ai_image['base64'])>12*1024*1024:raise ValueError('AI 图表数据无效')
            width_cm=chart_width(ai_image)
            title,section=ai_image.get('caption'),ai_image.get('section')
            if not isinstance(title,str) or not title.strip() or len(title)>200 or not isinstance(section,str) or not section or len(section)>100:raise ValueError('AI 图注或插入章节无效')
            content=base64.b64decode(ai_image['base64'],validate=True)
            ai_total_bytes+=len(content)
            if ai_total_bytes>32*1024*1024:raise ValueError('AI 图组超过 32 MB')
            if len(content)>8*1024*1024 or hashlib.sha256(content).hexdigest()!=ai_image.get('sha256'):raise ValueError('AI 图表校验失败')
            from PIL import Image
            with Image.open(io.BytesIO(content)) as png:
                if png.format!='PNG' or png.width>2200 or png.height>1600:raise ValueError('AI 图表格式或像素尺寸无效')
                png.verify()
            from docx import Document
            present={p.text.strip() for p in Document(output).paragraphs};headings=set(heading_texts)&present
            if section not in {section_name(t) for t in headings}:raise ValueError('报告没有章节“'+section+'”，请重新选择插入位置')
            image=job/f'adopted-ai-plot-{ai_index}.png';image.write_bytes(content)
            inserter=plot_helper('insert_chart');inserter._is_section_header=lambda text,target:section_name(text)==section;inserter._is_any_section_header=lambda text:text.strip() in headings
            inserter.insert_chart(str(output),str(image),section,width_cm,title)
            render_custom_caption(str(output),title)
        fitted_photos=fit_original_photo(output,photo_digest)
        if fitted_photos:logs.write('[提示] 原始数据照片已等比例适配页面，原图内容保留。\n')
        with zipfile.ZipFile(output) as archive:
            xml=archive.read('word/document.xml').decode('utf-8')
            if '%%DATA:' in xml:raise ValueError('报告含有未替换的数值占位符')
            from lxml import etree
            root=etree.fromstring(xml.encode());ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
            text=''.join(root.xpath('//w:t/text()|//m:t/text()',namespaces=ns))
            formula_count=len(root.xpath('//m:oMath',namespaces=ns))
            paragraphs=[''.join(p.xpath('.//w:t/text()|.//m:t/text()',namespaces=ns)) for p in root.xpath('//w:body/w:p',namespaces=ns)]
            rels=etree.fromstring(archive.read('word/_rels/document.xml.rels'))
            links={r.get('Id'):r.get('Target') for r in rels}
            embedded=[]
            ns.update({'a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'})
            for paragraph in root.xpath('//w:body/w:p',namespaces=ns):
                for rid in paragraph.xpath('.//a:blip/@r:embed',namespaces=ns):
                    target_image=links.get(rid,'')
                    if not target_image.startswith('media/'):continue
                    content=archive.read('word/'+target_image)
                    next_p=paragraph.getnext()
                    caption=caption_text(next_p) if next_p is not None else ''
                    if '原始数据记录照片' in caption or hashlib.sha256(content).hexdigest()==photo_digest:continue
                    embedded.append((content,caption,target_image))
        charts=[];seen=set();(job/'charts').mkdir()
        for content,caption,image_name in embedded:
            digest=hashlib.sha256(content).hexdigest()
            if digest in seen:continue
            seen.add(digest);file=job/'charts'/f'{len(charts)+1:02d}{Path(image_name).suffix}'
            file.write_bytes(content);charts.append({'name':caption or f'图 {len(charts)+1}','path':str(file),'bytes':len(content)})
        after=math_stats();failed=after['failed']-before['failed']
        if failed:raise ValueError(f'有 {failed} 条公式未正确转换，请检查报告引擎')
        sections={}
        for line in logs.getvalue().splitlines():
            if line.startswith('.LAB_SECTIONS_JSON:'):sections=json.loads(line.split(':',1)[1])
        from docx import Document
        present={p.text.strip() for p in Document(output).paragraphs}
        headings=list(dict.fromkeys(section_name(t) for t in heading_texts if t in present))
        try:copy_sections,copy_issues,copy_math=copy_capture.extract(output,heading_texts)
        except Exception:copy_sections,copy_issues,copy_math={},{'analysis':'报告章节源文提取未完成，请重新生成后核对','quiz':'报告章节源文提取未完成，请重新生成后核对'},{}
        result=json.dumps({'copySections':copy_sections,'copyIssues':copy_issues,'copyMath':copy_math,'path':str(output),'job':str(job),'name':exp['name']+'实验报告.docx','bytes':output.stat().st_size,'formulaCount':formula_count,'sections':sections,'headings':headings,'charts':charts,'text':text,'paragraphs':paragraphs,'log':logs.getvalue()[-4000:]},ensure_ascii=False,allow_nan=False)
        completed=True
        return result
    finally:
        import matplotlib.pyplot as plt
        plt.close('all')
        os.chdir(previous)
        sys.path[:]=previous_path
        for key in list(os.environ):
            if key.startswith('LAB_'):del os.environ[key]
        os.environ.update(previous_env)
        if variants_loader is not None:variants_module.load_variants=variants_loader
        copy_capture.restore()
        OriginalWriter.add_heading=original_heading
        if not completed:shutil.rmtree(job,ignore_errors=True)

def release_report(job):
    path=Path(job)
    if path.parent==Path('/lab/jobs') and path.name.startswith('job-'):shutil.rmtree(path,ignore_errors=True)
