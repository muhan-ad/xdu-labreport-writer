"""Apply text-only variant edits to report-local template reads, then restore the loader."""
import json,re
def checked_edits(raw):
    if raw is None:return {}
    if not isinstance(raw,dict) or len(raw)>32 or len(json.dumps(raw,ensure_ascii=False).encode())>200000:raise ValueError('变体调整配置无效或过大')
    formulas=lambda text:re.findall(r'(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$(?:\\.|[^$\\])+(?<!\\)\$',text)
    for section,items in raw.items():
        if not isinstance(section,str) or not section or len(section)>100 or not isinstance(items,dict) or len(items)>64:raise ValueError('变体章节无效')
        for index,edit in items.items():
            if not isinstance(index,str) or not re.fullmatch(r'(0|[1-9]\d?)',index) or not isinstance(edit,dict):raise ValueError('变体编号无效')
            original,text=edit.get('original'),edit.get('text')
            if not isinstance(original,str) or not original.strip() or len(original)>20000 or not isinstance(text,str) or not text.strip() or len(text)>20000:raise ValueError('变体文本无效')
            if formulas(original)!=formulas(text) or re.findall(r'%%[\s\S]*?%%',original)!=re.findall(r'%%[\s\S]*?%%',text):raise ValueError('变体公式或数据占位符已变化')
    return raw
def checked_standalone(text):
    if not isinstance(text,str) or not text.strip() or len(text)>20000:raise ValueError('独立变体文本无效')
    def checked(match):
        width,precision=match.group(3),match.group(4)
        if int(width or '0')>100 or (precision is not None and int(precision)>12):raise ValueError('独立变体数据占位符宽度或精度过大')
        return ''
    remaining=re.sub(r'%%DATA:([A-Za-z_][A-Za-z0-9_.]*):(%[-+ #0]{0,5}(\d{0,3})(?:\.(\d{1,2}))?[diouxXeEfFgGs])%%',checked,text)
    if '%%DATA' in remaining:raise ValueError('独立变体数据占位符格式无效')
def checked_additions(raw):
    if raw is None:return {}
    if not isinstance(raw,dict) or len(raw)>32 or len(json.dumps(raw,ensure_ascii=False).encode())>200000:raise ValueError('自建变体候选无效或过大')
    for section,rows in raw.items():
        if not isinstance(rows,list) or not rows or len(rows)>64:raise ValueError('自建候选数量无效')
        seen=set()
        for row in rows:
            if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not re.fullmatch(r'[a-f0-9]{64}',row['id']) or row['id'] in seen:raise ValueError('自建候选编号无效')
            seen.add(row['id']);index=row.get('baseIndex');count=row.get('baseCount')
            if not isinstance(count,int) or isinstance(count,bool) or not 1<=count<=100 or not isinstance(index,int) or isinstance(index,bool) or not 0<=index<count:raise ValueError('自建候选来源编号无效')
            if 'standalone' in row:
                if row['standalone'] is not True or index!=0:raise ValueError('独立变体标记无效')
                checked_standalone(row.get('original'));checked_standalone(row.get('text'))
            checked_edits({section:{str(index):{'original':row.get('original'),'text':row.get('text')}}})
    return raw
def edited_loader(loader,edits,applied,job,additions=None,appended=None):
    from pathlib import Path
    def load(script_dir):
        loaded=loader(script_dir)
        if not (edits or additions) or not loaded:return loaded
        if not Path(script_dir).resolve().is_relative_to(job.resolve()):raise ValueError('变体目录不属于当前报告')
        for section,rows in (additions or {}).items():
            if section not in loaded:continue
            variants=loaded[section]
            if not isinstance(variants,list) or len(variants)+len(rows)>100:raise ValueError('自建候选章节或数量不匹配')
            base_count=len(variants)
            for row in rows:
                index=row['baseIndex']
                if row['baseCount']!=base_count or index>=base_count or (not row.get('standalone') and variants[index]!=row['original']):raise ValueError('自建候选对应的内置原文已变化')
                variants.append(row['text']);appended.add((section,row['id']))
        for section,items in edits.items():
            if section not in loaded:continue
            variants=loaded[section]
            if not isinstance(variants,list):raise ValueError('该章节不支持调整变体')
            for index,edit in items.items():
                number=int(index)
                if number>=len(variants) or variants[number]!=edit['original']:raise ValueError('内置变体已变化，请恢复后重新调整')
                variants[number]=edit['text'];applied.add((section,index))
        return loaded
    return load
