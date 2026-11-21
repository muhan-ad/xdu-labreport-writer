import test from 'node:test';
import assert from 'node:assert/strict';
import {sequenceSetting,sequenceValues} from '../src/domain/measurement-sequence.js';

const generate = (name, key, count, start, step, field = {}) =>
  sequenceValues(sequenceSetting(name, key), field, count, 'generate', start, step);

test('measurement progression preserves decimal values and the current table length', () => {
  assert.deepEqual(generate('霍尔效应实验','t1_im_a',9,'0.2','0.1',{maximum:1}),
    [0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1]);
  assert.deepEqual(generate('电子偏转特性的测量','D_m',5,'-6','3'),[-6,-3,0,3,6]);
  assert.equal(generate('衍射光强分布的测量','x',42,'0','1').at(-1),41);
  assert.throws(() => generate('霍尔效应实验','t1_im_a',9,'0.3','0.1',{maximum:1}),/超出/);
  for (const step of ['0','','1e400','-1e-325'])
    assert.throws(() => generate('衍射光强分布的测量','x',42,'0',step));
});

test('Newton rings allow either direction while coil and polarization retain their exact presets', () => {
  assert.equal(generate('平凸透镜曲率半径的测量','rings',10,'25','-1').at(-1),16);
  assert.equal(generate('平凸透镜曲率半径的测量','rings',10,'11','1').at(-1),20);
  assert.throws(() => generate('平凸透镜曲率半径的测量','rings',10,'20','-2'),/步长/);
  const coil=sequenceSetting('直螺线管磁场分布的测量','x_mm');
  assert.deepEqual(sequenceValues(coil,{},16,'preset','','').slice(4,8),[80,100,110,120]);
  assert.throws(() => sequenceValues(coil,{},15,'preset','',''),/不一致/);
  const polarization=sequenceSetting('光的偏振特性测量','cos2_values');
  const theory=sequenceValues(polarization,{},7,'preset','','');
  assert.deepEqual([theory[0],theory[3],theory[6]],[1,0.5,0]);
  assert.equal(sequenceSetting('电子元件伏安特性的测量','t3_i'),undefined);
});
