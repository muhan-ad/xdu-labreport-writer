import mapping from "../data/preparation.json" with { type: "json" };
export function preparationTarget(name: string): {url: string; matched: boolean} {
  const normalized = name.trim().replace(/\(/g, "（").replace(/\)/g, "）");
  const id = (mapping as Record<string, number>)[normalized];
  return id
    ? {url:`https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=${id}`, matched:true}
    : {url:"https://wlsyzx.xidian.edu.cn/expe/index.html", matched:false};
}
export function preparationUrl(name: string): string { return preparationTarget(name).url; }
