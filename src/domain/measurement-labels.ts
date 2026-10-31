/** Keep this group concise; the phase interval is chosen separately. */
export function measurementGroupTitle(sourceId:string,title:string):string {
  if ((sourceId==='声速的测量（空气）'||sourceId==='声速的测量（水中）') &&
      title==='位相比较法（李萨如图形法）— 同/反相点位置（12 次）')
    return '位相比较法（12 次）';
  return title;
}
