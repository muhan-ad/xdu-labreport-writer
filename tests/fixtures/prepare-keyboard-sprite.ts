const keys=[16,17,18,19,20,21,22,23,24,25,30,31,32,33,34,35,36,37,38,44,45,46,48,49,50];
export async function prepareKeyboardSprite(){
 const context=new OfflineAudioContext(2,1,44100);
 const config=await (await fetch('/guide-audio/config.json')).json(),source=await context.decodeAudioData(await (await fetch('/guide-audio/keyboard.ogg')).arrayBuffer());
 const rate=source.sampleRate,channels=source.numberOfChannels;
 const clips=keys.map(key=>{const [offset,duration]=config.defines[String(key)];return {key,start:Math.floor(offset*rate/1000),frames:Math.ceil(duration*rate/1000)};});
 const gap=Math.ceil(rate*.02),frames=clips.reduce((sum,c)=>sum+c.frames+gap,0),pcm=new ArrayBuffer(frames*channels*2),data=new DataView(pcm),defines:Record<string,[number,number]>={};let cursor=0,maxError=0;
 for(const clip of clips){
  if(clip.start<0||clip.start+clip.frames>source.length)throw Error('Source clip exceeds recording');
  defines[String(clip.key)]=[cursor/rate*1000,clip.frames/rate*1000];
  for(let frame=0;frame<clip.frames;frame++)for(let channel=0;channel<channels;channel++){
   const raw=Math.max(-1,Math.min(1,source.getChannelData(channel)[clip.start+frame])),encoded=Math.round(raw*32767);
   data.setInt16(((cursor+frame)*channels+channel)*2,encoded,true);
  }
  cursor+=clip.frames+gap;
 }
 const wav=new ArrayBuffer(44+pcm.byteLength),view=new DataView(wav),ascii=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 ascii(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,pcm.byteLength,true);new Uint8Array(wav,44).set(new Uint8Array(pcm));
 // Decode the generated WAV and compare every retained sample with the source.
 const decoded=await context.decodeAudioData(wav.slice(0));
 for(const clip of clips){const start=Math.round(defines[String(clip.key)][0]*rate/1000);for(let channel=0;channel<channels;channel++)for(let frame=0;frame<clip.frames;frame++)maxError=Math.max(maxError,Math.abs(decoded.getChannelData(channel)[start+frame]-source.getChannelData(channel)[clip.start+frame]));}
 if(maxError>2/32768)throw Error('Unexpected waveform change');
 const bytes=new Uint8Array(wav);let encoded='';for(let offset=0;offset<bytes.length;offset+=16384)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
 return {wav:btoa(encoded),config:{...config,sound:'keyboard.wav',defines},metrics:{clips:clips.length,sampleRate:rate,channels,originalDuration:source.duration,duration:decoded.duration,originalDecodedBytes:source.length*channels*4,decodedBytes:decoded.length*channels*4,wavBytes:wav.byteLength,maxAbsoluteSampleError:maxError}};
}
