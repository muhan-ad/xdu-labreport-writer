import test from 'node:test';
import assert from 'node:assert/strict';
import {scanPixels} from '../src/domain/ocr-image.ts';
const image=rows=>new Uint8ClampedArray(rows.flat());
test('scan stretch whitens grey paper while keeping black strokes and alpha',()=>{
 const pixels=image([...Array.from({length:5},()=>[0,0,0,255]),...Array.from({length:95},()=>[200,200,200,255])]);scanPixels(pixels);
 assert.deepEqual([...pixels.slice(0,4)],[0,0,0,255]);assert.deepEqual([...pixels.slice(-4)],[255,255,255,255]);
});
test('scan low contrast retains original colored pixels instead of applying partial red removal',()=>{
 const pixels=image(Array.from({length:100},()=>[100,70,70,255])),before=pixels.slice();scanPixels(pixels);assert.deepEqual(pixels,before);
});
test('scan uses red-channel mapping only above one percent stamp coverage',()=>{
 const make=count=>image([...Array.from({length:5},()=>[0,0,0,255]),...Array.from({length:count},()=>[220,80,80,255]),...Array.from({length:95-count},()=>[200,200,200,255])]);
 const boundary=make(1);scanPixels(boundary);assert.notEqual(boundary[21],boundary[20]);
 const active=make(2);scanPixels(active);assert.equal(active[21],active[20]);assert.equal(active[22],active[20]);
});
test('scan rejects malformed RGBA data and leaves single-tone zero spread unchanged',()=>{
 assert.throws(()=>scanPixels(new Uint8ClampedArray(0)),/像素/);assert.throws(()=>scanPixels(new Uint8ClampedArray(3)),/像素/);
 const pixels=image([[42,42,42,83]]);scanPixels(pixels);assert.deepEqual([...pixels],[42,42,42,83]);
});
