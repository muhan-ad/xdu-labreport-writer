/** Keep this group concise; the phase interval is chosen separately. */
export function measurementGroupTitle(sourceId:string,title:string):string {
  if ((sourceId==='声速的测量（空气）'||sourceId==='声速的测量（水中）') &&
      title.startsWith('位相比较法（李萨如图形法）— 同/反相点位置'))
    return '位相比较法';
  return title.replace(/[（(]([^（）()]*)[）)]/g, (original: string, note: string) => {
    const parts = note.split('，');
    const remaining = parts.filter(part => !/\d\s*(?:个(?:测点|长度点)|条谱线|[量次点组列行孔对])/.test(part));
    if (remaining.length === parts.length) return original;
    return remaining.length ? original[0] + remaining.join('，') + original.at(-1) : '';
  }).trim();
}
