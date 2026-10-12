'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MAX_BYTES = 1000000;
// Preserve original evidence. Cache only the copy embedded in the report.
function prepareReportPhoto(source, cache, nativeImage) {
  const bytes = fs.readFileSync(source);
  const original = nativeImage.createFromBuffer(bytes);
  if (original.isEmpty()) throw Error('原始数据照片无法解码，请重新选择有效图片');
  if (bytes.length < MAX_BYTES) return source;
  const key = crypto.createHash('sha256').update(bytes).update('report-photo-v1').digest('hex');
  fs.mkdirSync(cache, {recursive:true});
  const dest = path.join(cache, key + '.jpg');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && fs.statSync(dest).size < MAX_BYTES) return dest;
  const size = original.getSize();
  let scale = 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const image = scale === 1 ? original : original.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'best'});
    let best = null, low = 65, high = 95;
    while (low <= high) {
      const quality = Math.floor((low + high)/2), result = image.toJPEG(quality);
      if (result.length < MAX_BYTES) { best = result; low = quality + 1; }
      else high = quality - 1;
    }
    if (best) {
      const tmp = dest + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(tmp,best); fs.renameSync(tmp,dest); }
      finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
      return dest;
    }
    scale *= .85;
  }
  throw Error('原始数据照片压缩失败，无法控制在 1 MB 以下');
}
module.exports = {prepareReportPhoto, MAX_BYTES};
