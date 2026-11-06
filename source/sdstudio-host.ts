/* Standalone host for the unmodified SDStudio NAI service. */
import {NovelAiImageGenService} from './vendor/SDStudio/src/renderer/backends/genVendors/nai';
import {Model,ModelVersion} from './vendor/SDStudio/src/renderer/backends/imageGen';
import {maskToBase64,getChunksInBrush,getChunksBetween} from './adapters/upstream-mask-functions';
import {snapMaskToGrid} from './vendor/SDStudio/src/renderer/models/focusedInpaint';
import {qualityPresetTextFor,ucPresetTextFor} from './vendor/SDStudio/src/renderer/backends/genVendors/naiQualityPresets';
import upstream from './UPSTREAM.json';
const models:any={v5:ModelVersion.V5,v45:ModelVersion.V4_5,v45c:ModelVersion.V4_5Curated};
const raw=(s:string)=>s.includes(',')?s.split(',')[1]:s;
const bytes=(s:string)=>Uint8Array.from(atob(raw(s)),c=>c.charCodeAt(0));
const hex=async (b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
const finite=(value:any,label:string,min:number,max:number,integer=false)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error(label+' 범위를 확인하세요.');return n;};
// Black/transparent means keep; a selected pixel expands to its complete 8x8
// cell. Run at import, preview, export AND the final request boundary.
function normalizeMaskData(image:ImageData,w:number,h:number,transparent=false){
 if(image.width!==w||image.height!==h||image.data.length!==w*h*4)throw Error('마스크 크기가 캔버스와 다릅니다.');
 const binary=new Uint8Array(w*h),rgba=image.data;
 for(let i=0;i<binary.length;i++)binary[i]=rgba[i*4+3]>0&&(rgba[i*4]!==0||rgba[i*4+1]!==0||rgba[i*4+2]!==0)?1:0;
 const aligned=snapMaskToGrid(binary,w,h,8),out=new Uint8ClampedArray(w*h*4);
 for(let i=0;i<aligned.length;i++){const v=aligned[i]?255:0,j=i*4;out[j]=out[j+1]=out[j+2]=v;out[j+3]=transparent?v:255;}
 return new ImageData(out,w,h);
}
function maskToDataURL(image:ImageData,w:number,h:number){return 'data:image/png;base64,'+maskToBase64(normalizeMaskData(image,w,h),w,h);}
async function alignMaskPNG(src:string,w:number,h:number){
 const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('마스크 PNG를 읽을 수 없습니다.'));i.src='data:image/png;base64,'+raw(src);});
 if(img.naturalWidth!==w||img.naturalHeight!==h)throw Error('마스크 크기가 캔버스와 다릅니다.');
 const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d')!;g.drawImage(img,0,0);
 return maskToDataURL(g.getImageData(0,0,w,h),w,h);
}
function strokeChunks(points:Array<{x:number,y:number}>,diameter:number,shape:string,w:number,h:number){
 const selected=new Map<string,{chunkX:number,chunkY:number}>(),r=Math.max(4,diameter/2);
 const add=(chunkX:number,chunkY:number)=>{if(chunkX>=0&&chunkY>=0&&chunkX*8<w&&chunkY*8<h)selected.set(chunkX+','+chunkY,{chunkX,chunkY});};
 for(let i=0;i<points.length;i++){
  const a=points[i-1]??points[i],b=points[i];
  if(shape==='round'){
   const chunks=i?getChunksBetween(a.x,a.y,b.x,b.y,r):getChunksInBrush(b.x,b.y,r);
   for(const q of chunks)add(q.chunkX,q.chunkY);
   if(!chunks.length)add(Math.floor(b.x/8),Math.floor(b.y/8));
  }else{
   const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/4));
   for(let j=0;j<=n;j++){const x=a.x+(b.x-a.x)*j/n,y=a.y+(b.y-a.y)*j/n;
    for(let cy=Math.floor((y-r)/8);cy<Math.ceil((y+r)/8);cy++)for(let cx=Math.floor((x-r)/8);cx<Math.ceil((x+r)/8);cx++)add(cx,cy);
   }
  }
 }
 return [...selected.values()];
}
class LocalZipBridge {
 body:any=null;wire='';
 async fetchArrayBuffer(url:string,body:any,_headers:any){
  const operation=url==='https://image.novelai.net/ai/generate-image'?'generate':url==='https://image.novelai.net/ai/upscale'?'upscale':null;
  if(!operation)throw Error('이 도구에서 지원하지 않는 SDStudio 작업입니다.');
  this.wire=JSON.stringify(body);this.body=JSON.parse(this.wire);
  const response=await fetch('/api/relay',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Key':document.querySelector<HTMLMetaElement>('meta[name="studio-key"]')!.content},body:JSON.stringify({operation,serializedBody:this.wire})});
  if(!response.ok){const d=await response.json();throw Error(d.error||'SDStudio 요청 전송 실패');}
  const expected=response.headers.get('X-Request-SHA256');if(expected&&expected!==await hex(new TextEncoder().encode(this.wire)))throw Error('중계한 요청 본문의 해시가 일치하지 않습니다.');
  return await response.arrayBuffer();
 }
}
function migrateParams(input:any){
 const p={...input},version=models[p.model]??ModelVersion.V5;
 if(p.qualityPreset===undefined&&p.qualityHint!==undefined){
  let preset=({1:'standard',3:'light'} as any)[p.qualityHint]||'none';
  const text=qualityPresetTextFor(version,preset),suffix=', '+text;
  if(text&&String(p.prompt??'').endsWith(suffix))p.prompt=String(p.prompt).slice(0,-suffix.length);else preset='none';
  p.qualityPreset=preset;
 }
 if(p.ucPreset===undefined&&p.ucHint!==undefined){
  let preset=({2:'heavy',3:'light',4:'humanFocus',5:'furryFocus'} as any)[p.ucHint]||'none';
  const text=ucPresetTextFor(version,preset),value=String(p.negative??'');
  if(text&&value.startsWith(text+', '))p.negative=value.slice(text.length+2);else if(text&&value===text)p.negative='';else preset='none';
  p.ucPreset=preset;
 }
 return p;
}
function generationInput(scene:any){
 const p=scene.params;
 if(!models[p.model])throw Error('V5 또는 V4.5 모델을 선택하세요.');
 const quality=p.qualityPreset??'none',uc=p.ucPreset??'none';
 if(!['standard','light','none'].includes(quality)||!['none','heavy','light','humanFocus','furryFocus'].includes(uc))throw Error('SDStudio 프리셋을 확인하세요.');
 const seed=Number(p.seed);
 return {
  model:Model.Inpaint,prompt:String(p.prompt),uc:String(p.negative??''),
  resolution:{width:scene.width,height:scene.height},sampling:p.sampler,
  outputFilePath:'',steps:finite(p.steps,'Steps',1,50,true),promptGuidance:finite(p.guidance,'CFG',0,10),cfgRescale:finite(p.rescale,'CFG Rescale',0,1),noiseSchedule:p.schedule,
  vibes:[],characterReferences:[],image:raw(scene.image),mask:raw(scene.mask),imageStrength:finite(p.strength,'강도',0,1),originalImage:!!p.preserveOutside,
  seed:seed<0?undefined:finite(seed,'시드',0,4294967295,true),
  sm:false,dyn:false,useCoords:false,legacyPromptConditioning:false,
  generationSettings:{schemaVersion:1,modelVersion:models[p.model],furryMode:false,disableQuality:quality==='none',qualityPreset:quality,ucPreset:uc,transparentBackground:false,autoConvertWebp:false,autoConvertWebpQuality:80}
 };
}
async function generate(scene:any){
 scene={...scene,mask:await alignMaskPNG(scene.mask,scene.width,scene.height)};
 const transport=new LocalZipBridge(),service=new NovelAiImageGenService(transport),input=generationInput(scene);
 // The upstream class builds and sends the request and unpacks its ZIP itself.
 const result=await service.generateImage('local-token-bridge',input as any);
 const body=transport.body,p=body.parameters,params=Object.fromEntries(Object.entries(p).filter(([k])=>k!=='image'&&k!=='mask'));
 const request={...body,parameters:params,image_sha256:await hex(bytes(p.image)),mask_sha256:await hex(bytes(p.mask)),transport_body_sha256:await hex(new TextEncoder().encode(transport.wire))};
 return {image:'data:image/png;base64,'+result,width:p.width,height:p.height,seed:p.seed,request,settings:{...params,model:body.model,prompt:body.input,uc:p.negative_prompt}};
}
async function upscale(src:string){
 const transport=new LocalZipBridge(),service=new NovelAiImageGenService(transport);
 const result=await service.upscaleImage('local-token-bridge',{image:raw(src)});
 const data=bytes(result),v=new DataView(data.buffer);return {image:'data:image/png;base64,'+result,width:v.getUint32(16),height:v.getUint32(20)};
}
(window as any).SDStudioCore=Object.freeze({generate,upscale,migrateParams,maskToDataURL,normalizeMaskData,strokeChunks,alignMaskPNG,info:upstream});
