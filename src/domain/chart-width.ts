/** Desktop chart insertion uses centimetres, defaults to 14, range 4–20. */
export function validChartWidth(value:unknown):value is number|undefined {
  return value===undefined||(typeof value==='number'&&Number.isFinite(value)&&value>=4&&value<=20);
}
export function chartWidth(value:unknown):number {
  if(!validChartWidth(value))throw Error('图片宽度须为 4–20 cm');
  return value??14;
}
