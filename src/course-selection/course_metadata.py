"""Read-only teacher/room queries. Never guess a teacher from another week or slot."""
import re
import os
import json
import threading
from pathlib import Path
import time

def text(node):return node.get_text(' ',strip=True) if node else ''
def key(value):return re.sub(r'(?:[（(]\d+学时[）)]|\d+学时).*$','',re.sub(r'\s+','',str(value))).strip()

def grid_blocks(page):
    for table in page.find_all('table'):
        occupied={};out=[]
        for r,row in enumerate(tr for tr in table.find_all('tr') if tr.find_parent('table') is table):
            values={c:v for (rr,c),v in occupied.items() if rr==r};c=0
            for cell in row.find_all(['th','td'],recursive=False):
                if cell.find('table'):continue
                while c in values:c+=1
                width=min(int(cell.get('colspan',1)),30);height=min(int(cell.get('rowspan',1)),200)
                for cc in range(c,c+width):
                    values[cc]=text(cell)
                    for rr in range(r+1,r+height):occupied[rr,cc]=text(cell)
                c+=width
            if values:out.append([values.get(i,'') for i in range(max(values)+1)])
        if out:yield table,out

def grids(page):
    for _,rows in grid_blocks(page):yield rows

def header_index(row,labels):
    return next((i for i,value in enumerate(row) if any(label in key(value) for label in labels)),None)

def room_rows(page):
    blocks=list(grid_blocks(page))
    for block_index,(table,grid) in enumerate(blocks):
        for pos,row in enumerate(grid):
            name=header_index(row,['实验项目','实验名称','项目名称'])
            room=header_index(row,['实验地点','实验室','教室','上课地点','地点','实验用房'])
            if name is None or room is None or name==room:continue
            for cells in grid[pos+1:]:
                if max(name,room)<len(cells):yield cells[name],cells[room]
            # ASP.NET DataList may render HeaderTemplate and ItemTemplate as
            # separate nested tables. Only inherit columns within the same owner.
            if pos==len(grid)-1:
                owner=table.find_parent('table') or table.parent
                # Official ExpeClassList: the header is a child table, while
                # ItemTemplate rows (including invalid nested tr wrappers) belong
                # directly to its parent table. Read only following full-width rows.
                if owner.name=='table':
                    header_row=table.find_parent('tr')
                    started=False
                    for tr in owner.find_all('tr'):
                        if tr.find_parent('table') is not owner:continue
                        if tr is header_row:started=True;continue
                        if not started:continue
                        cells=tr.find_all(['td','th'],recursive=False)
                        if any(cell.find('table') for cell in cells):break
                        if len(cells)==len(row):yield text(cells[name]),text(cells[room])
                for other,rows in blocks[block_index+1:]:
                    if (other.find_parent('table') or other.parent) is not owner:break
                    if any(header_index(cells,['实验项目','实验名称','项目名称']) is not None for cells in rows):break
                    if not all(len(cells)==len(row) for cells in rows):break
                    for cells in rows:yield cells[name],cells[room]
            break

def parse_rooms(page):
    result={}
    for name,room in room_rows(page):
        n=key(name);location=room.strip()
        if n and location and not any(s in n for s in ['实验项目','实验名称','项目名称']):result.setdefault(n,set()).add(location)
    return {name:sorted(rooms) for name,rooms in result.items()}

def parse_schedule(page,experiment,scoped=False):
    result=[]
    for grid in grids(page):
        for pos,row in enumerate(grid):
            teacher=header_index(row,['任课教师','指导教师','教师','主讲教师']);slot=header_index(row,['上课时间','实验时间','时间安排','上课时段','实验时段'])
            first=header_index(row,['开始周','起始周','起止周']);last=header_index(row,['结束周','终止周']);name=header_index(row,['实验项目','实验名称','项目名称'])
            if teacher is None or slot is None or first is None:continue
            if name is None and not scoped:continue
            active=header_index(row,['是否开课','开课状态']);parity=header_index(row,['单双周'])
            for cells in grid[pos+1:]:
                if max(teacher,slot,first,last or 0,name or 0,active or 0,parity or 0)>=len(cells):continue
                if name is not None and key(cells[name])!=key(experiment):continue
                if active is not None and active<len(cells) and cells[active] in ['否','不开课','停课']:continue
                match=re.search(r'星期([一二三四五六日天])((?:下午|晚上|上午))\s*(\d{1,2}:\d{2})\s*[-–—～~]\s*(\d{1,2}:\d{2})',cells[slot])
                week_numbers=re.findall(r'\d+',cells[first]);end_numbers=re.findall(r'\d+',cells[last]) if last is not None else week_numbers[1:]
                if not match or not week_numbers or not end_numbers or not cells[teacher].strip():continue
                begin,end=int(week_numbers[0]),int(end_numbers[-1])
                if not 1<=begin<=end<=60:continue
                cycle=cells[parity].strip() if parity is not None and parity<len(cells) else ''
                if cycle not in ['','每周','全部','单周','双周','单','双']:continue
                result.append(dict(time=f'星期{match[1].replace("天","日")}{match[2]}{match[3].zfill(5)}-{match[4].zfill(5)}',teacher=cells[teacher].strip(),firstWeek=begin,lastWeek=end,parity=cycle))
            break
    return result

DIAGNOSTIC_LOCK=threading.Lock()
def diagnostic(label,page,code):
    # Only structural control names and table headings; never form values or response bodies.
    base=os.environ.get('LAB_COURSE_DATA_DIR')
    if not base:return
    try:
        headings=[]
        for grid in grids(page) if page is not None else []:
            for row in grid:
                if any(key(cell) in ['教师','任课教师','实验名称','实验项目','实验室','教室','实验时间','起始周','开始周'] for cell in row):
                    headings.append([cell[:50] for cell in row[:16]]);break
        room_samples=[]
        if label=='实验项目查询' and page is not None:
            room_samples=[[name[:100],room[:100]] for name,room in list(room_rows(page))[:6]]
        record={'roomSamples':room_samples[:6],'time':int(time.time()),'page':label,'code':code,
                'headings':headings[:8],'gridShapes':[[len(row) for row in grid[:4]] for grid in list(grids(page))[:20]] if page is not None else [],
                'selects':[{'name':str(c.get('name',''))[:120],'count':len(c.find_all('option'))} for c in (page.find_all('select')[:12] if page is not None else [])],
                'buttons':[{'name':str(c.get('name',''))[:120],'type':c.get('type','')} for c in (page.find_all('input') if page is not None else []) if c.get('type','').lower() in ['image','submit']]}
        file=Path(base).parent/'course-metadata.log';file.parent.mkdir(parents=True,exist_ok=True)
        with DIAGNOSTIC_LOCK:
            if file.exists() and file.stat().st_size>65536:file.write_text('',encoding='utf-8')
            with file.open('a',encoding='utf-8') as stream:stream.write(json.dumps(record,ensure_ascii=False)+'\n')
    except (OSError,ValueError):pass

class MetadataReader:
    def __init__(self,api):self.api=api;self.pages={};self.cache={};self.created=time.monotonic()
    def route(self,label):
        # Official read-only entries supplied for the two school query pages.
        routes={'实验项目查询':'http://wlsy.xidian.edu.cn/PhyEws/student/expeinfo.aspx',
                '课程安排':'http://wlsy.xidian.edu.cn/PhyEws/student/course.aspx'}
        if label not in routes:raise ValueError('不支持的官网查询入口')
        return routes[label]
    def page(self,label):
        if label not in self.pages:
            route=self.route(label);self.pages[label]=(route,self.api.request(route,timeout=(5,10)))
        return self.pages[label]
    def query(self,label,experiment):
        route,page=self.page(label)
        choices=[]
        for select in page.find_all('select',attrs={'name':True}):
            options=[o for o in select.find_all('option') if key(text(o))==key(experiment)]
            if len(options)==1:choices.append((select,options[0]))
        if len(choices)>1:raise ValueError('官网实验查询选项不唯一')
        if not choices:
            diagnostic(label,page,'no_experiment_selector')
            return page,False
        select,option=choices[0];changes={select['name']:option.get('value',text(option))}
        buttons=[b for b in page.find_all('input',attrs={'name':True}) if b.get('type','').lower() in ['submit','image'] and (any(t in str(b.get('value',''))+str(b.get('alt','')) for t in ['查询','检索']) or re.search(r'btn(?:Submit|Query|Search)$',b['name'],re.I))]
        if len(buttons)==1:
            button=buttons[0]
            if button.get('type','').lower()=='image':return self.api.post(route,page,changes,button=button['name'],timeout=(5,10)),True
            changes[button['name']]=button.get('value','查询');return self.api.post(route,page,changes,timeout=(5,10)),True
        if (label=='课程安排' and select['name']=='plan1$ExpeList') or '__doPostBack' in str(select.get('onchange','')):return self.api.post(route,page,changes,event=select['name'],timeout=(5,10)),True
        diagnostic(label,page,'query_control_unrecognized')
        raise ValueError('官网查询提交控件无法可靠识别')
    def lookup(self,experiment):
        now=time.monotonic();cached=self.cache.get(key(experiment))
        if cached and now-cached['time']<(30 if cached['data']['warnings'] else 600):return cached['data']
        if now-self.created>600:self.pages.clear();self.created=now
        result=dict(name=experiment,rooms=[],schedules=[],warnings=[])
        for label in ['实验项目查询','课程安排']:
            try:
                page,scoped=self.query(label,experiment)
                if label=='实验项目查询':
                    result['rooms']=parse_rooms(page).get(key(experiment),[])
                    diagnostic(label,page,'rooms_matched' if result['rooms'] else 'room_table_unmatched')
                    if not result['rooms']:
                        result['warnings'].append('官网实验项目查询未匹配到教室')
                else:
                    result['schedules']=parse_schedule(page,experiment,scoped)
                    diagnostic(label,page,'schedules_matched' if result['schedules'] else 'schedule_table_unmatched')
                    if not result['schedules']:
                        result['warnings'].append('官网课程安排未匹配到教师记录')
            except ValueError as error:result['warnings'].append(str(error))
            except Exception as error:
                diagnostic(label,None,'request_failed_'+type(error).__name__)
                if getattr(error,'status',None)==401:raise
                result['warnings'].append('官网'+label+'读取未完成，请刷新重试')
        self.cache[key(experiment)]={'time':now,'data':result};return result
