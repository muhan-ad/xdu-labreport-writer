"""Shared report prose structure; never introduces measurement values."""
import re


def normalize_document_paragraphs(doc):
    """Split lists and parallel equations after incremental run construction.

    Move copies of original OOXML slices: keep native equations, fonts and runs;
    never turn equations into plain text. Tables and picture paragraphs are excluded.
    """
    from copy import deepcopy
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    math_ns='http://schemas.openxmlformats.org/officeDocument/2006/math'
    marker=re.compile(r'[（(]\s*(?:\d+|[一二三四五六七八九十]+)\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|(?<![\d.])\d+[、．]|(?<![\d.])\d+\.(?!\d)\s*|首先|其次|再次|最后')
    for paragraph in list(doc.paragraphs):
        p=paragraph._p
        if p.find('.//'+qn('w:drawing')) is not None:continue
        atoms=[];source='';safe=True
        for child in p:
            if child.tag==qn('w:pPr'):continue
            if child.tag in (f'{{{math_ns}}}oMath',f'{{{math_ns}}}oMathPara'):
                value='\ue100'
            elif child.tag==qn('w:r') and all(c.tag in (qn('w:rPr'),qn('w:t')) for c in child):
                value=''.join(t.text or '' for t in child.findall(qn('w:t')))
            else:safe=False;break
            atoms.append((len(source),len(source)+len(value),child));source+=value
        if not safe or not source.strip():continue
        matches=[m for m in marker.finditer(source)
                 if (m.start()==0 or source[m.start()-1] not in '式/') and source[m.end():m.end()+1]!='式'
                 and not (m.group().endswith('、') and source[m.end():m.end()+1].isdigit())]
        # A real list needs at least two markers. A single numbered heading stays intact.
        cuts=[0]
        if len(matches)>=2:
            for m in matches:
                if m.start() and (m.group()[0].isdigit() or m.group().startswith(('（','(')) or m.group()[0] in '①②③④⑤⑥⑦⑧⑨⑩' or source[:m.start()].rstrip()[-1:] in '。；;：:,，'):
                    cuts.append(m.start())
        spans=[]
        bounds=sorted(set(cuts))+[len(source)]
        for lo,hi in zip(bounds,bounds[1:]):
            equations=[(a,b,c) for a,b,c in atoms if a>=lo and b<=hi and c.tag.startswith('{'+math_ns+'}')
                       and re.search(r'[=≈≃≤≥<>∝∼≡]', ''.join(c.itertext()))]
            if len(equations)>=2:
                start=lo
                for a,b,c in equations:
                    # Keep short explanatory labels with the equation they name,
                    # instead of creating orphan paragraphs such as “时” or “由”.
                    tail=re.match(r'[\s）)、,，；;。]*',source[b:hi]).group(0)
                    end=b+len(tail)
                    spans.append((start,end,True));start=end
                if source[start:hi].strip():spans.append((start,hi,False))
            else:spans.append((lo,hi,False))
        if len(spans)==1:continue
        for lo,hi,display in spans:
            value=source[lo:hi]
            if not value.strip(' \n\t；;，,。:：（）()'):continue
            node=OxmlElement('w:p')
            if p.pPr is not None:node.append(deepcopy(p.pPr))
            for a,b,child in atoms:
                left,right=max(a,lo),min(b,hi)
                if left>=right:continue
                copy=deepcopy(child)
                if child.tag==qn('w:r'):
                    text=source[left:right]
                    for c in list(copy):
                        if c.tag!=qn('w:rPr'):copy.remove(c)
                    t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text;copy.append(t)
                node.append(copy)
            if display:
                from docx.text.paragraph import Paragraph
                from docx.enum.text import WD_ALIGN_PARAGRAPH
                from docx.shared import Pt
                block=Paragraph(node,paragraph._parent)
                block.alignment=WD_ALIGN_PARAGRAPH.CENTER
                block.paragraph_format.first_line_indent=Pt(0)
                block.paragraph_format.space_after=Pt(6)
            p.addprevious(node)
        p.getparent().remove(p)


def error_points(text):
    """Idempotent numbered paragraphs; protect formulas and result placeholders."""
    protected=[]
    def hold(m):
        protected.append(m.group(0));return f"\ue000{len(protected)-1}\ue001"
    source=re.sub(r'%%DATA:.*?%%|\$\$[\s\S]*?\$\$|\$[^$\n]*\$',hold,str(text or '').strip())
    # Existing numbering or bullets establish the semantic points; otherwise use sentences.
    marker=r'(?:[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、．]\s*|[-*•]\s+)'
    lines=[v.strip() for v in re.split(r'\n+|(?<=[。；])\s*(?='+marker+r')',source) if v.strip()]
    has_list=sum(bool(re.match(marker,v)) for v in lines)>=2
    if not has_list:
        lines=[v.strip() for line in lines for v in re.split(r'(?<=。)',line) if v.strip()]
    result=[]
    point_number=0
    for value in lines:
        value=re.sub(r'^'+marker,'',value).strip()
        if not value:continue
        formula_only = re.fullmatch(r'\ue000(\d+)\ue001', value)
        if formula_only and protected[int(formula_only.group(1))].startswith('$$'):
            result.append(protected[int(formula_only.group(1))]);continue
        for i,raw in enumerate(protected):value=value.replace(f"\ue000{i}\ue001",raw)
        if value.endswith('；'): value=value[:-1]+'。'
        point_number += 1
        result.append(f'（{point_number}）{value}')
    return '\n\n'.join(result)


def split_caption(text):
    """One title paragraph followed by optional explanatory paragraphs."""
    lines=[v.strip() for v in str(text or '').strip().splitlines() if v.strip()]
    if not lines:return '图表', ''
    first=lines.pop(0)
    # Chinese full stops separate a short title from explanatory prose; decimal dots do not.
    if '。' in first:
        first,rest=first.split('。',1)
        if rest.strip():lines.insert(0,rest.strip())
    if '注：' in first:
        first,rest=first.split('注：',1);lines.insert(0,rest.strip())
    return first.strip() or '图表', '\n'.join(lines)
