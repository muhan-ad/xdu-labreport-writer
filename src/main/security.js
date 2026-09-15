'use strict';
const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-html');

function inside(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('文件不在允许的目录内');
  // Refuse reparse points/symlinks even when the final target happens to be inside.
  let cursor = path.resolve(file);
  const bound = path.resolve(root);
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('不允许访问链接文件或目录');
    if (cursor === bound) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) throw Error('无效路径');
    cursor = parent;
  }
  if (fs.existsSync(file) && fs.existsSync(root)) {
    const realRel = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    if (realRel === '..' || realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) throw Error('真实路径越界');
  }
  return path.resolve(file);
}
function trustedSender(event, contents, url) {
  return !!(contents && event && event.sender === contents && event.senderFrame &&
    event.senderFrame === contents.mainFrame && event.senderFrame.url === url);
}
function cleanHtml(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 24 * 1024 * 1024) throw Error('预览内容过大');
  return sanitize(html, {
    allowedTags: sanitize.defaults.allowedTags.concat(['img', 'section', 'article', 'sup', 'sub']),
    allowedAttributes: { '*': ['class'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], img: ['src', 'alt', 'width', 'height'] },
    allowedSchemes: ['data'],
    transformTags: { img: (tagName, attribs) => ({ tagName, attribs: /^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribs.src || '') ? attribs : { alt: attribs.alt || '' } }) },
  });
}
module.exports = { inside, trustedSender, cleanHtml };
