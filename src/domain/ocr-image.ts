/** Original desktop scan mapping: red-channel stamp handling and tonal stretch.
 * Works in-place on a bounded, already resized RGBA image. It cannot recover
 * handwriting physically obscured by a stamp or fix every shadow.
 */
export function scanPixels(pixels:Uint8ClampedArray){
 if(!pixels.length||pixels.length%4)throw Error('图片像素格式异常');
 const total=pixels.length/4;let red=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i]>60&&pixels[i]-Math.max(pixels[i+1],pixels[i+2])>14)red++;
 const useRed=red/total>.01;
 const histogram=new Uint32Array(256);
 for(let i=0;i<pixels.length;i+=4){const green=useRed?pixels[i]:pixels[i+1],blue=useRed?pixels[i]:pixels[i+2];histogram[Math.round(Math.min(255,Math.max(0,.299*pixels[i]+.587*green+.114*blue))) ]++;}
 let cumulative=0,white=255,black=0;
 for(let tone=255;tone>=0;tone--){cumulative+=histogram[tone];if(cumulative>=total*.85){white=tone;break;}}
 cumulative=0;
 for(let tone=0;tone<=255;tone++){cumulative+=histogram[tone];if(cumulative>=total*.02){black=tone;break;}}
 const range=white-black;
 if(range<10)return;
 const scale=255/range;
 for(let i=0;i<pixels.length;i+=4){const redValue=pixels[i];for(let channel=0;channel<3;channel++)pixels[i+channel]=Math.min(255,Math.max(0,Math.round(((useRed?redValue:pixels[i+channel])-black)*scale)));}
}
