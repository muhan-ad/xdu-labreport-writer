// Android System WebView may expose SubtleCrypto without Ed25519 support.
// Retain native verification where available; load the local strict verifier only
// for NotSupportedError. Invalid signatures never trigger an acceptance fallback.
const prefix=Uint8Array.of(0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00);
export async function verifyPublisherSignature(spki:Uint8Array,signature:Uint8Array,message:Uint8Array):Promise<boolean>{
 if(spki.length!==44||!prefix.every((n,i)=>spki[i]===n)||signature.length!==64)return false;
 try{
  const key=await crypto.subtle.importKey('spki',spki as Uint8Array<ArrayBuffer>,{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify('Ed25519',key,signature as Uint8Array<ArrayBuffer>,message as Uint8Array<ArrayBuffer>);
 }catch(error){
  if((error as {name?:string})?.name!=='NotSupportedError')throw error;
 }
 const {verifyAsync}=await import('@noble/ed25519');
 return verifyAsync(signature,message,spki.subarray(prefix.length),{zip215:false});
}
