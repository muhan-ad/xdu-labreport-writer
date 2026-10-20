import unittest
from bs4 import BeautifulSoup
from course_metadata import parse_rooms,parse_schedule,MetadataReader,key,diagnostic
import tempfile,os,json
from pathlib import Path
from unittest.mock import patch

def page(s):return BeautifulSoup(s,'html.parser')
class MetadataTests(unittest.TestCase):
 def test_whitespace_in_experiment_credit_suffix(self):
  self.assertEqual(key('A （3 学时）'),'A')
 def test_diagnostic_excludes_form_values_and_personal_content(self):
  with tempfile.TemporaryDirectory() as folder:
   with patch.dict(os.environ,{'LAB_COURSE_DATA_DIR':str(Path(folder)/'academic')}):
    diagnostic('课程安排',page('<input name="password" value="SECRET"><input type="hidden" value="TOKEN"><select name="ExpeList"><option value="PRIVATE">A</option></select><table><tr><th>实验时间</th><th>教师</th></tr><tr><td>星期一</td><td>PRIVATE_NAME</td></tr></table>'),'unmatched')
   raw=(Path(folder)/'course-metadata.log').read_text(encoding='utf-8')
   for secret in ['SECRET','TOKEN','PRIVATE','PRIVATE_NAME']:self.assertNotIn(secret,raw)
   self.assertEqual(json.loads(raw)['selects'][0],{'name':'ExpeList','count':1})
 def test_room_rowspan_and_multiple_locations_are_preserved(self):
  result=parse_rooms(page('<table><tr><th>实验项目</th><th>实验室</th></tr><tr><td>A</td><td rowspan="2">楼201</td></tr><tr><td>B</td></tr><tr><td>A</td><td>楼202</td></tr></table>'))
  self.assertEqual(result,{'A':['楼201','楼202'],'B':['楼201']})
 def test_room_header_and_items_in_separate_nested_template_tables(self):
  html='<table><tr><td><table><tr><th>实验项目</th><th>容纳人数</th><th>上课教室</th><th>讲义出处</th><th>备注</th><th>是否开放</th></tr></table></td></tr><tr><td><table><tr><td>A</td><td>20</td><td>楼201</td><td></td><td></td><td>是</td></tr></table></td></tr><tr><td><table><tr><td>B</td><td>20</td><td>楼202</td><td></td><td></td><td>是</td></tr></table></td></tr></table>'
  self.assertEqual(parse_rooms(page(html)),{'A':['楼201'],'B':['楼202']})
 def test_room_fragment_does_not_cross_owners_or_different_column_counts(self):
  html='<div><table><tr><th>实验项目</th><th>上课教室</th></tr></table></div><div><table><tr><td>A</td><td>错误教室</td></tr></table></div>'
  self.assertEqual(parse_rooms(page(html)),{})
  html='<div><table><tr><th>实验项目</th><th>上课教室</th></tr></table><table><tr><td>A</td><td>错误教室</td><td>其他表</td></tr></table></div>'
  self.assertEqual(parse_rooms(page(html)),{})
 def test_saved_official_project_html_extracts_real_classrooms(self):
  fixture=Path(__file__).resolve().parents[2]/'tests/fixtures/course-room-projects.html'
  result=parse_rooms(page(fixture.read_text(encoding='utf-8')))
  self.assertEqual(len(result),18)
  self.assertEqual(result['电子束的电磁偏转特性实验'],['F217'])
  self.assertEqual(result['RLC电路的稳态特性研究实验'],['F218'])
 def test_nested_header_does_not_use_parent_rows_before_header(self):
  html='<table><tr><td>其他实验</td><td>错误教室</td></tr><tr><td><table><tr><th>实验项目</th><th>上课教室</th></tr></table></td></tr><tr><td><tr><td>A</td><td>楼201</td></tr></td></tr></table>'
  self.assertEqual(parse_rooms(page(html)),{'A':['楼201']})
 def test_schedule_requires_experiment_scope_and_preserves_week_ranges(self):
  html='<table><tr><th>实验时间</th><th>任课教师</th><th>开始周</th><th>结束周</th><th>是否开课</th></tr><tr><td>星期一下午15:55-18:10</td><td>教师甲</td><td>2</td><td>8</td><td>是</td></tr><tr><td>星期一下午15:55-18:10</td><td>教师乙</td><td>9</td><td>14</td><td>是</td></tr><tr><td>星期二晚上18:30-20:45</td><td>停课教师</td><td>2</td><td>14</td><td>否</td></tr></table>'
  self.assertEqual(parse_schedule(page(html),'A'),[])
  rows=parse_schedule(page(html),'A',True);self.assertEqual(len(rows),2);self.assertEqual(rows[1]['firstWeek'],9)
 def test_explicit_name_table_does_not_mix_other_experiments(self):
  rows=parse_schedule(page('<table><tr><th>实验名称</th><th>实验时间</th><th>教师</th><th>起始周</th><th>终止周</th></tr><tr><td>B</td><td>星期一下午15:55-18:10</td><td>教师乙</td><td>1</td><td>19</td></tr></table>'),'A')
  self.assertEqual(rows,[])
 def test_official_plan_selector_uses_read_only_postback_without_inline_script(self):
  class API:
   def request(self,path,**kwargs):return page('<select name="plan1$ExpeList"><option value="A1">A 3学时</option></select>')
   def post(self,path,html,changes,**kwargs):
    self.posted=(path,changes,kwargs)
    return page('<table><tr><th>上课时间</th><th>上课教师</th><th>起始周</th><th>结束周</th><th>是否开课</th></tr><tr><td>星期一下午15:55-18:10</td><td>教师甲</td><td>2</td><td>14</td><td>是</td></tr></table>')
  api=API();reader=MetadataReader(api);result,scoped=reader.query('课程安排','A')
  self.assertTrue(scoped);self.assertEqual(api.posted[1],{'plan1$ExpeList':'A1'});self.assertEqual(api.posted[2]['event'],'plan1$ExpeList')
  self.assertEqual(parse_schedule(result,'A',scoped)[0]['teacher'],'教师甲')
 def test_room_names_accept_credit_suffix_with_or_without_parentheses(self):
  result=parse_rooms(page('<table><tr><th>实验项目</th><th>容纳人数</th><th>上课教室</th><th>讲义出处</th><th>备注</th><th>是否开放</th></tr><tr><td>A 3学时</td><td>20</td><td>楼201</td><td></td><td></td><td>是</td></tr></table>'))
  self.assertEqual(result.get('A'),['楼201'])
 def test_reader_uses_fixed_query_links_without_menu_and_never_submits_enrollment(self):
  class API:
   navigation=None
   def __init__(self):self.posts=[];self.requests=[]
   def request(self,path,**kwargs):
    self.requests.append(path)
    if path.endswith('/expeinfo.aspx'):return page('<table><tr><th>实验名称</th><th>教室</th></tr><tr><td>A</td><td>楼201</td></tr></table>')
    return page('<form><select name="Header$Name"><option value="A1">A(3学时)</option></select><input type="submit" name="Query" value="查询"></form>')
   def post(self,path,html,changes,**kwargs):
    self.posts.append((path,changes,kwargs));return page('<table><tr><th>实验时间</th><th>教师</th><th>开始周</th><th>结束周</th></tr><tr><td>星期一下午15:55-18:10</td><td>教师甲</td><td>2</td><td>14</td></tr></table>')
  api=API();reader=MetadataReader(api);result=reader.lookup('A');self.assertEqual(result['rooms'],['楼201']);self.assertEqual(result['schedules'][0]['teacher'],'教师甲');self.assertEqual(api.posts[0][1],{'Header$Name':'A1','Query':'查询'})
  self.assertEqual(reader.lookup('A'),result);self.assertEqual(len(api.posts),1)
  self.assertEqual(api.requests,['http://wlsy.xidian.edu.cn/PhyEws/student/expeinfo.aspx','http://wlsy.xidian.edu.cn/PhyEws/student/course.aspx'])
  self.assertEqual(api.posts[0][0],api.requests[1])
  with self.assertRaises(ValueError):reader.route('任意网站')
if __name__=='__main__':unittest.main()
