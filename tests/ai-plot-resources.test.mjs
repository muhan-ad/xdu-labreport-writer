import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {plotResourceNames,validPlotPng} from '../src/domain/ai-plot-resources.ts';
test('isolated plot loads only bundled dependency closure and rejects missing/traversing packages',()=>{
 const lock=JSON.parse(fs.readFileSync('public/report-runtime/pyodide-lock.json')),manifest=JSON.parse(fs.readFileSync('public/report-runtime/manifest.json'));
 const files=plotResourceNames(lock);assert.equal(new Set(files).size,files.length);assert.ok(files.every(name=>manifest.files[name]));
 assert.ok(!files.some(n=>n.startsWith('lxml-')||n.startsWith('python_docx-')||n==='report-sources.json'));
 const missing=structuredClone(lock);delete missing.packages.numpy;assert.throws(()=>plotResourceNames(missing),/依赖/);
 const traversal=structuredClone(lock);traversal.packages.numpy.file_name='../outside.whl';assert.throws(()=>plotResourceNames(traversal),/依赖/);
});
test('scientific wheels are included only for matching code with complete offline dependencies',()=>{
 const lock=JSON.parse(fs.readFileSync('public/report-runtime/pyodide-lock.json')),manifest=JSON.parse(fs.readFileSync('public/report-runtime/manifest.json'));
 const plain=plotResourceNames(lock,'import numpy as np'),scipy=plotResourceNames(lock,'from scipy.optimize import curve_fit'),pandas=plotResourceNames(lock,'import pandas as pd'),both=plotResourceNames(lock,'import scipy, pandas');
 assert.equal(plain.some(n=>n.startsWith('scipy-')||n.startsWith('pandas-')||n.startsWith('libopenblas-')),false);assert.ok(scipy.some(n=>n.startsWith('scipy-')));assert.ok(scipy.some(n=>n.startsWith('libopenblas-')));assert.equal(scipy.some(n=>n.startsWith('pandas-')),false);assert.ok(pandas.some(n=>n.startsWith('pandas-')));assert.ok(pandas.some(n=>n.startsWith('pytz-')));assert.equal(pandas.some(n=>n.startsWith('scipy-')),false);assert.ok(both.every(n=>manifest.files[n]));assert.equal(new Set(both).size,both.length);
 assert.ok(both.reduce((total,name)=>total+manifest.files[name].bytes,0)<100*1024*1024);const missing=structuredClone(lock);delete missing.packages.libopenblas;assert.throws(()=>plotResourceNames(missing,'import scipy'),/依赖/);
});
test('plot result PNG bounds reject oversized headers and malformed packets before image decode',()=>{
 const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10]);png.set([73,72,68,82],12);new DataView(png.buffer).setUint32(16,1200);new DataView(png.buffer).setUint32(20,800);assert.equal(validPlotPng(png),true);
 for(const width of [0,2201,0xffffffff]){const bytes=Uint8Array.from(png);new DataView(bytes.buffer).setUint32(16,width);assert.equal(validPlotPng(bytes),false);}
 assert.equal(validPlotPng(new Uint8Array(20)),false);assert.equal(validPlotPng(new Uint8Array(8*1024*1024+1)),false);
 const broken=Uint8Array.from(png);broken[12]=0;assert.equal(validPlotPng(broken),false);
});
