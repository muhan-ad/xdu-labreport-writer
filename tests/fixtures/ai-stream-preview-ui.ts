import {AIStreamPreview} from '../../src/features/ai-stream-preview.ts';
export function createPreview(){const controller=new AbortController(),preview=new AIStreamPreview(controller.signal,()=>controller.abort());return {observer:preview.observer,stop:()=>controller.abort(),close:()=>preview.close(),aborted:()=>controller.signal.aborted};}
