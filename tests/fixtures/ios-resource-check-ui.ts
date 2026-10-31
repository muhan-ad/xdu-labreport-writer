import {ResourceCheck} from '../../src/features/resource-check.ts';
export function openResourceCheck(){const notices:string[]=[];const view=new ResourceCheck(text=>notices.push(text));view.mount(document.querySelector<HTMLElement>('#resource-host')!);return {notices,leave:()=>view.leave()};}
