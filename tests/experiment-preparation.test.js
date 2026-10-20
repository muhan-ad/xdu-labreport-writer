'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const preparation=require('../src/shared/experiment-preparation');
test('known experiments link to their official detail pages, including shared semester/medium pages',()=>{
 const cases={'刚体转动惯量的测量':3,'光的偏振特性测量':5,'光的偏振特性测量（第二学期）':5,'薄透镜焦距的测量（凹透镜）':20,'薄透镜焦距的测量（凸透镜）':20,'声速的测量（空气）':10,'声速的测量（水中）':10,'重力加速度的测量':11,'霍尔效应实验':24};
 for(const [name,id]of Object.entries(cases))assert.equal(preparation.url(name),'https://wlsyzx.xidian.edu.cn/expe/experiment.html?id='+id);
});
test('every shipped experiment has an audited mapping or an explicit unavailable result',()=>{
 const missing=[];for(const e of fs.readdirSync(path.join(__dirname,'../物理实验/实验脚本'),{withFileTypes:true})){if(!e.isDirectory()||e.name==='common')continue;if(!preparation.url(e.name))missing.push(e.name);}
 assert.deepEqual(missing.sort(),['电子元件伏安特性的测量','长度与体积的测量'].sort());assert.equal(preparation.url(undefined),null);assert.equal(preparation.url('toString'),null);assert.equal(preparation.url('任意未知实验'),null);
});

test('semester display names share the same preparation material without matching unknown experiments',()=>{
 const shared=preparation.url('光的偏振特性测量');
 for(const semester of ['第一学期','第二学期','上学期','下学期']){
  assert.equal(preparation.url(`光的偏振特性测量（${semester}）`),shared);
  assert.equal(preparation.url(` 光的偏振特性测量(${semester}) `),shared);
 }
 assert.equal(preparation.url('未知实验（第二学期）'),null);
 assert.notEqual(preparation.url('光栅光谱的测量'),preparation.url('光的偏振特性测量'));
});
