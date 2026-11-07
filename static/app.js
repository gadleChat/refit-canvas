'use strict';
const $=id=>document.getElementById(id), cv=$('editor'), ctx=cv.getContext('2d');
const S={w:1216,h:832,layers:[],selected:null,tool:'move',zoom:1,strokes:[],redo:[],results:[],activeResult:null,viewFull:false,busy:false,connected:false,lastExport:null,frozenInput:null,maskBase:null};
let drag=null, cursor=null, space=false, toastTimer, userAccount=null;
const params=['model','prompt','negative','steps','guidance','sampler','seed','strength','rescale','schedule','referenceTag','autoCrop','qualityPreset','ucPreset','preserveOutside'];
const main=()=>S.layers.find(l=>l.role==='main');
const selected=()=>S.layers.find(l=>l.id===S.selected);
const elCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function toast(s,error=false){$('toast').textContent=s;$('toast').className=error?'error':'';$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',error?10000:3800);}
function status(s){$('status').textContent=s;}
async function call(path,data={}){const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Key':document.querySelector('meta[name="studio-key"]').content},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'요청 실패');return d;}
function safe(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{toast(e.message,true);status('작업 실패 · '+e.message);});}
function image(src){return new Promise((resolve,reject)=>{if(!/^data:image\/(png|jpeg|webp);base64,/.test(src))return reject(Error('PNG/JPEG/WebP 이미지만 지원합니다.'));const i=new Image();i.onload=()=>{if(i.width*i.height>25000000)return reject(Error('입력 이미지가 너무 큽니다. 2500만 화소 이하로 줄여주세요.'));resolve(i);};i.onerror=()=>reject(Error('이미지를 읽을 수 없습니다.'));i.src=src;});}
function fileData(file){return new Promise((resolve,reject)=>{if(!file||file.size>32*1024*1024)return reject(Error('32MB 이하 이미지를 선택하세요.'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('파일 읽기 실패'));r.readAsDataURL(file);});}
function getParams(){return Object.fromEntries(params.map(k=>[k,$(k).type==='checkbox'?$(k).checked:$(k).value]));}
function setParams(input){const p=SDStudioCore.migrateParams({...input});params.forEach(k=>{if(k in p){if($(k).type==='checkbox')$(k).checked=!!p[k];else $(k).value=p[k];}});updateCost();}

function snapshot(){if(S.frozenInput)return structuredClone(S.frozenInput.snapshot);const m=main();if(!m)throw Error('메인 이미지를 먼저 넣어주세요.');const x=Math.max(0,m.x),y=Math.max(0,m.y),r=Math.min(S.w,m.x+m.w),b=Math.min(S.h,m.y+m.h);if(r<=x||b<=y)throw Error('메인 이미지가 캔버스 밖에 있습니다.');return {w:S.w,h:S.h,rect:{x,y,w:r-x,h:b-y},cropVersion:2};}
function renderBase(){const c=elCanvas(S.w,S.h),g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,S.w,S.h);for(const l of S.layers)g.drawImage(l.img,l.x,l.y,l.w,l.h);return c;}
function toCanvasStroke(s,m){if(s.space==='canvas')return s;if(!m)return null;return {...s,space:'canvas',...(s.fill?{rect:{x:m.x,y:m.y,w:m.w,h:m.h}}:{size:s.size*m.w,points:s.points.map(p=>({x:m.x+p.x*m.w,y:m.y+p.y*m.h}))})};}
function maskCanvas(opaque=false){
 const c=elCanvas(S.w,S.h),g=c.getContext('2d');
 if(S.maskBase){g.drawImage(S.maskBase,0,0);g.putImageData(SDStudioCore.normalizeMaskData(g.getImageData(0,0,S.w,S.h),S.w,S.h,true),0,0);}
 for(const saved of S.strokes){
  const s=toCanvasStroke(saved,main());if(!s)continue;
  g.globalCompositeOperation=s.erase?'destination-out':'source-over';g.fillStyle='#fff';
  if(s.fill){const r=s.rect||{x:0,y:0,w:S.w,h:S.h},x=Math.floor(r.x/8)*8,y=Math.floor(r.y/8)*8;g.fillRect(x,y,Math.ceil((r.x+r.w)/8)*8-x,Math.ceil((r.y+r.h)/8)*8-y);continue;}
  for(const q of SDStudioCore.strokeChunks(s.points,s.size,s.shape,S.w,S.h))g.fillRect(q.chunkX*8,q.chunkY*8,8,8);
 }
 g.globalCompositeOperation='source-over';g.putImageData(SDStudioCore.normalizeMaskData(g.getImageData(0,0,S.w,S.h),S.w,S.h,!opaque),0,0);return c;
}
// Display caches: the base composite and the tinted mask overlay are rebuilt only when their inputs change,
// and a stroke being painted is added cell by cell instead of replaying every stroke on each pointer move.
const VIEW={base:null,baseKey:'',mask:null,maskKey:'',maskRef:null,maskLen:0,maskLast:null,maskLastN:0,raf:0};
const imgIds=new WeakMap();let imgSeq=0;
function imgId(o){if(!o)return 0;let v=imgIds.get(o);if(!v){v=++imgSeq;imgIds.set(o,v);}return v;}
function cachedBase(){const k=S.w+'x'+S.h+'|'+S.layers.map(l=>imgId(l.img)+':'+l.x+','+l.y+','+l.w+','+l.h).join('|');if(VIEW.baseKey!==k||!VIEW.base){VIEW.base=renderBase();VIEW.baseKey=k;}return VIEW.base;}
const MASK_TINT='#f74e9e';
// Cells of a finished stroke are cached per stroke (WeakMap, so nothing leaks into saved projects).
const strokeCellCache=new WeakMap();
function strokeCells(saved,s){if(s.fill)return null;const m=main(),k=S.w+'x'+S.h+'|'+(saved.space==='canvas'?'':m?[m.x,m.y,m.w,m.h].join(','):'-')+'|'+s.points.length+'|'+s.size+'|'+s.shape;const hit=strokeCellCache.get(saved);if(hit&&hit.k===k)return hit.cells;const cells=SDStudioCore.strokeChunks(s.points,s.size,s.shape,S.w,S.h);strokeCellCache.set(saved,{k,cells});return cells;}
function importedMaskTint(){const k=imgId(S.maskBase)+'|'+S.w+'x'+S.h;if(VIEW.baseMaskKey!==k){const c=elCanvas(S.w,S.h),g=c.getContext('2d');g.drawImage(S.maskBase,0,0);g.putImageData(SDStudioCore.normalizeMaskData(g.getImageData(0,0,S.w,S.h),S.w,S.h,true),0,0);g.globalCompositeOperation='source-in';g.fillStyle=MASK_TINT;g.fillRect(0,0,S.w,S.h);VIEW.baseMaskTint=c;VIEW.baseMaskKey=k;}return VIEW.baseMaskTint;}
function rebuildMaskOverlay(){const c=elCanvas(S.w,S.h),g=c.getContext('2d');if(S.maskBase)g.drawImage(importedMaskTint(),0,0);for(const saved of S.strokes){const s=toCanvasStroke(saved,main());if(!s)continue;const cells=strokeCells(saved,s);if(cells){g.globalCompositeOperation=s.erase?'destination-out':'source-over';g.fillStyle=MASK_TINT;for(const q of cells)g.fillRect(q.chunkX*8,q.chunkY*8,8,8);g.globalCompositeOperation='source-over';}else paintMaskCells(g,s,null);}return c;}
function paintMaskCells(g,s,points){g.globalCompositeOperation=s.erase?'destination-out':'source-over';g.fillStyle=MASK_TINT;if(s.fill){const r=s.rect||{x:0,y:0,w:S.w,h:S.h},x=Math.floor(r.x/8)*8,y=Math.floor(r.y/8)*8;g.fillRect(x,y,Math.ceil((r.x+r.w)/8)*8-x,Math.ceil((r.y+r.h)/8)*8-y);}else for(const q of SDStudioCore.strokeChunks(points,s.size,s.shape,S.w,S.h))g.fillRect(q.chunkX*8,q.chunkY*8,8,8);g.globalCompositeOperation='source-over';}
function cachedMask(){
 const m=main(),geo=S.w+'x'+S.h+'|'+imgId(S.maskBase)+'|'+(m?[m.x,m.y,m.w,m.h].join(','):'-');
 const last=S.strokes[S.strokes.length-1]||null,n=last?.points?.length||0,len=S.strokes.length;
 const same=VIEW.mask&&VIEW.maskKey===geo&&VIEW.maskRef===S.strokes;
 const remember=()=>{VIEW.maskKey=geo;VIEW.maskRef=S.strokes;VIEW.maskLen=len;VIEW.maskLast=last;VIEW.maskLastN=n;return VIEW.mask;};
 if(same&&len===VIEW.maskLen&&last===VIEW.maskLast&&n===VIEW.maskLastN)return VIEW.mask;
 if(same&&len===VIEW.maskLen&&last===VIEW.maskLast&&last.space==='canvas'&&!last.fill&&n>VIEW.maskLastN){paintMaskCells(VIEW.mask.getContext('2d'),last,last.points.slice(Math.max(0,VIEW.maskLastN-1)));return remember();}
 if(same&&len===VIEW.maskLen+1&&S.strokes[len-2]===VIEW.maskLast&&last.space==='canvas'){paintMaskCells(VIEW.mask.getContext('2d'),last,last.points||[]);return remember();}
 VIEW.mask=rebuildMaskOverlay();return remember();
}
function scheduleDraw(){if(VIEW.raf)return;VIEW.raf=requestAnimationFrame(()=>{VIEW.raf=0;draw();});}
// Small previews for lists instead of multi-MB data URLs.
function thumbOf(img,rect,max){const r=rect||{x:0,y:0,w:img.width,h:img.height},k=Math.min(1,max/Math.max(r.w,r.h)),c=elCanvas(Math.max(1,Math.round(r.w*k)),Math.max(1,Math.round(r.h*k))),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(img,r.x,r.y,r.w,r.h,0,0,c.width,c.height);return c.toDataURL('image/webp',0.86);}
function layerThumb(l){if(l.thumbImg!==l.img||!l.thumb){l.thumb=thumbOf(l.img,null,160);l.thumbImg=l.img;}return l.thumb;}
function resultThumbs(r,img){const s=r.snapshot,sx=img.width/s.w,sy=img.height/s.h;r.thumbFull=thumbOf(img,null,640);r.thumb=thumbOf(img,{x:s.rect.x*sx,y:s.rect.y*sy,w:s.rect.w*sx,h:s.rect.h*sy},640);}
async function ensureResultThumbs(r){if(r.thumb&&r.thumbFull)return;try{resultThumbs(r,await image(r.src));}catch{}}
function setResultImg(im,r,full){const pick=()=>full?r.thumbFull:r.thumb;im.src=pick()||(full?r.src:r.crop);if(!pick())ensureResultThumbs(r).then(()=>{if(pick())im.src=pick();});}
function draw(){if(cv.width!==S.w||cv.height!==S.h){cv.width=S.w;cv.height=S.h;}ctx.drawImage(cachedBase(),0,0);if($('showMask').checked&&(S.strokes.length||S.maskBase)){ctx.save();ctx.globalAlpha=.48;ctx.drawImage(cachedMask(),0,0);ctx.restore();}const l=selected();if(l&&S.tool==='move'){ctx.save();ctx.strokeStyle=l.role==='main'?'#8867ed':'#2eb3ac';ctx.lineWidth=2/S.zoom;ctx.setLineDash([6/S.zoom,4/S.zoom]);ctx.strokeRect(l.x,l.y,l.w,l.h);ctx.setLineDash([]);ctx.fillStyle='#fff';for(const [x,y] of corners(l)){ctx.fillRect(x-4/S.zoom,y-4/S.zoom,8/S.zoom,8/S.zoom);ctx.strokeRect(x-4/S.zoom,y-4/S.zoom,8/S.zoom,8/S.zoom);}ctx.restore();}if(cursor&&S.tool!=='move'){ctx.save();ctx.strokeStyle='#cf3d87';ctx.lineWidth=1/S.zoom;const r=+$('brushSize').value/2;ctx.beginPath();if($('brushShape').value==='square')ctx.rect(cursor.x-r,cursor.y-r,r*2,r*2);else ctx.arc(cursor.x,cursor.y,r,0,Math.PI*2);ctx.stroke();ctx.restore();}$('empty').hidden=S.layers.length>0;}
function corners(l){return [[l.x,l.y],[l.x+l.w,l.y],[l.x+l.w,l.y+l.h],[l.x,l.y+l.h]];}
function updateInspector(){const l=selected();$('inspector').hidden=!l;if(l){$('ix').value=Math.round(l.x);$('iy').value=Math.round(l.y);$('iw').value=Math.round(l.w);$('ih').value=Math.round(l.h);$('duplicate').disabled=l.role==='main';}}
function layersUI(){frozenUI();const box=$('layers');box.replaceChildren();S.layers.forEach(l=>{const row=document.createElement('div');row.className='layer'+(S.selected===l.id?' selected':'');const im=document.createElement('img');im.src=layerThumb(l);const title=document.createElement('div');title.className='name';title.textContent=l.name;const sm=document.createElement('small');sm.textContent=l.role==='main'?'MAIN · 자동 잘라내기 영역':'REFERENCE · 비율 고정';title.append(sm);const lock=document.createElement('button');lock.textContent=l.locked?'잠금':'↔';lock.title='배치 잠금';lock.onclick=e=>{e.stopPropagation();l.locked=!l.locked;layersUI();};const edit=document.createElement('button');edit.textContent='✂';edit.title='자르기·지우기';edit.disabled=!!S.frozenInput;edit.onclick=e=>{e.stopPropagation();S.selected=l.id;openImageEditor(l);};row.append(im,title,edit,lock);row.onclick=()=>{S.selected=l.id;layersUI();};box.append(row);});updateInspector();draw();}
function zoom(z){S.zoom=Math.max(.08,Math.min(3,z));cv.style.width=S.w*S.zoom+'px';cv.style.height=S.h*S.zoom+'px';$('zoomLabel').textContent=Math.round(S.zoom*100)+'%';draw();}
function fit(){zoom(Math.min(($('stage').clientWidth-72)/S.w,($('stage').clientHeight-72)/S.h));}
function fitMain(){const m=main();if(!m)return;const scale=Math.min(S.h/m.img.height,S.w/m.img.width);m.w=m.img.width*scale;m.h=m.img.height*scale;m.x=0;m.y=0;layersUI();}
function arrange(){const refs=S.layers.filter(l=>l.role==='ref');if(!refs.length)return;const m=main();let left=m?Math.max(0,Math.min(S.w-80,m.x+m.w+16)):S.w*.5;let avail=S.w-left-16;const cols=Math.ceil(Math.sqrt(refs.length*avail/S.h)),ncols=Math.max(1,Math.min(refs.length,cols)),rows=Math.ceil(refs.length/ncols),cellW=avail/ncols,cellH=(S.h-32)/rows;refs.forEach((l,i)=>{const scale=Math.min((cellW-12)/l.img.width,(cellH-16)/l.img.height);l.w=Math.max(8,l.img.width*scale);l.h=l.w*l.img.height/l.img.width;l.x=left+(i%ncols)*cellW+(cellW-l.w)/2;l.y=16+Math.floor(i/ncols)*cellH+(cellH-l.h)/2;});layersUI();}
// Fill prompt + negative from a NAI PNG's embedded settings when a main image is opened (toggle: #autoPrompt).
async function autoPromptFrom(src){if(!$('autoPrompt').checked||!src.startsWith('data:image/png'))return;let result;try{result=await PNGMeta.read(src);}catch{return;}const f=PNGMeta.form(result);let prompt=String(f.prompt||'').trim(),negative=String(f.negative||'').trim();if(!prompt&&!negative)return;const model=$('model').value,qh={standard:1,light:3}[$('qualityPreset').value],uh={heavy:2,light:3,humanFocus:4,furryFocus:5}[$('ucPreset').value];if(qh){const m=SDStudioCore.migrateParams({model,prompt,qualityHint:qh});if(m.qualityPreset!=='none')prompt=m.prompt;}if(uh){const m=SDStudioCore.migrateParams({model,negative,ucHint:uh});if(m.ucPreset!=='none')negative=m.negative;}const replaced=($('prompt').value&&$('prompt').value!==prompt)||($('negative').value&&$('negative').value!==negative);$('prompt').value=prompt;$('negative').value=negative;updateCost();toast(replaced?'메인 이미지의 프롬프트·네거티브로 바꿨어요. (자동 입력은 프롬프트 아래 체크로 끌 수 있어요)':'메인 이미지의 프롬프트·네거티브를 넣었어요.');}
// Main-only mode: no empty reference area; the canvas follows the main image (~1MP, 64px steps) and the main covers it.
const MAIN_ONLY_MAX=1048576;
function mainOnlySize(iw,ih){const ar=iw/ih;let best=null;for(let W=64;W<=4096;W+=64){const H=Math.round(W/ar/64)*64;if(H<64||H>4096||W*H>MAIN_ONLY_MAX)continue;const c={W,H,err:Math.abs(W/H/ar-1),area:W*H};if(!best||(c.err<=0.02?(best.err>0.02||c.area>best.area):(best.err>0.02&&c.err<best.err)))best=c;}return best;}
function applyMainOnly(){const m=main();if(!$('mainOnly').checked||!m||S.frozenInput)return;const z=mainOnlySize(m.img.width,m.img.height);if(!z)throw Error('이 이미지 비율로는 캔버스를 만들 수 없습니다.');S.w=z.W;S.h=z.H;$('cw').value=S.w;$('ch').value=S.h;$('preset').value='custom';const s=Math.max(S.w/m.img.width,S.h/m.img.height);m.w=m.img.width*s;m.h=m.img.height*s;m.x=(S.w-m.w)/2;m.y=(S.h-m.h)/2;m.locked=true;S.selected=m.id;layersUI();fit();updateCost();}
async function addFile(file,role){if(S.layers.length>=32)throw Error('이미지는 최대 32장까지 배치할 수 있습니다.');const src=await fileData(file),img=await image(src),l={id:crypto.randomUUID(),role,name:file.name,baseName:stem(file.name)||'refit',src,img,x:0,y:0,w:100,h:100,locked:false};if(role==='main'){if(S.frozenInput){S.layers=[];S.frozenInput=null;S.maskBase=null;}S.layers=S.layers.filter(x=>x.role!=='main');S.layers.unshift(l);S.strokes=[];S.redo=[];}else S.layers.push(l);S.selected=l.id;if(role==='main'){fitMain();applyMainOnly();}else arrange();layersUI();if(role==='main'){await autoPromptFrom(src);if($('mainOnly').checked&&!S.frozenInput)toast(`메인 이미지만 수정 · 캔버스 ${S.w} × ${S.h}`);}}
function setTool(t){S.tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));cv.style.cursor=t==='move'?'default':'crosshair';draw();}
const point=e=>{const r=cv.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*S.w,y:(e.clientY-r.top)/r.height*S.h};};
cv.addEventListener('pointerdown',e=>{if(e.button!==0)return;cv.setPointerCapture(e.pointerId);const p=point(e);if(space){drag={type:'pan',x:e.clientX,y:e.clientY,left:$('stage').scrollLeft,top:$('stage').scrollTop};return;}if(S.tool==='move'){let l=selected();if(l&&!l.locked){const c=corners(l),i=c.findIndex(([x,y])=>Math.hypot(p.x-x,p.y-y)<12/S.zoom);if(i>=0){const a=c[(i+2)%4];drag={type:'resize',l,ax:a[0],ay:a[1],sx:i===1||i===2?1:-1,sy:i>=2?1:-1,w:l.w,h:l.h};return;}}l=[...S.layers].reverse().find(l=>p.x>=l.x&&p.x<=l.x+l.w&&p.y>=l.y&&p.y<=l.y+l.h);S.selected=l?.id||null;layersUI();if(l&&!l.locked)drag={type:'move',l,dx:p.x-l.x,dy:p.y-l.y};}else{S.redo=[];const s={space:'canvas',erase:S.tool==='erase',shape:$('brushShape').value,size:+$('brushSize').value,points:[p]};S.strokes.push(s);drag={type:'paint',s};draw();}});
cv.addEventListener('pointermove',e=>{const p=point(e);cursor=p;if(drag){if(drag.type==='pan'){$('stage').scrollLeft=drag.left-(e.clientX-drag.x);$('stage').scrollTop=drag.top-(e.clientY-drag.y);}else if(drag.type==='move'){drag.l.x=p.x-drag.dx;drag.l.y=p.y-drag.dy;updateInspector();}else if(drag.type==='resize'){const d=drag,t=Math.max(8/Math.min(d.w,d.h),((p.x-d.ax)*d.sx*d.w+(p.y-d.ay)*d.sy*d.h)/(d.w*d.w+d.h*d.h));d.l.w=d.w*t;d.l.h=d.h*t;d.l.x=d.sx>0?d.ax:d.ax-d.l.w;d.l.y=d.sy>0?d.ay:d.ay-d.l.h;updateInspector();}else if(drag.type==='paint'){drag.s.points.push(p);}}scheduleDraw();});
function endDrag(){drag=null;}
cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);cv.addEventListener('lostpointercapture',endDrag);cv.addEventListener('pointerleave',()=>{cursor=null;draw();});
$('stage').addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();zoom(S.zoom*(e.deltaY<0?1.1:.9));}},{passive:false});
function undo(){if(S.strokes.length)S.redo.push(S.strokes.pop());draw();}function redo(){if(S.redo.length)S.strokes.push(S.redo.pop());draw();}
const TEXT_INPUTS=['text','number','search','password','email','url','tel'];
function typingInto(el){return !!el&&(el.tagName==='TEXTAREA'||el.isContentEditable||(el.tagName==='INPUT'&&TEXT_INPUTS.includes(el.type)));}
window.addEventListener('keydown',e=>{const a=document.activeElement;if(typingInto(a)||document.querySelector('dialog[open]'))return;const k=e.key.toLowerCase(),handled=['v','b','e','[',']'].includes(k)&&!e.ctrlKey&&!e.altKey&&!e.metaKey;if((handled||e.code==='Space'||(e.ctrlKey&&k==='z'))&&a&&a!==document.body&&a.blur)a.blur();if(handled)e.preventDefault();if(e.code==='Space'){space=true;e.preventDefault();}if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(e.key.toLowerCase()==='v')setTool('move');if(e.key.toLowerCase()==='b')setTool('brush');if(e.key.toLowerCase()==='e')setTool('erase');if(e.key==='['||e.key===']'){$('brushSize').value=Math.min(200,Math.max(2,+$('brushSize').value+(e.key===']'?5:-5)));$('brushSize').dispatchEvent(new Event('input'));}});window.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>{space=false;drag=null;});
// Default save names follow the main image's file name (without extension).
function stem(n){return String(n||'').replace(/\.[^.\\/]+$/,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().replace(/[. ]+$/,'').slice(0,80);}
function baseName(){return main()?.baseName||'refit';}
function download(src,name){const a=document.createElement('a');a.href=src;a.download=name;document.body.append(a);a.click();a.remove();}
function downloadJSON(d,name){const u=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'}));download(u,name);setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function confirmAction(title,text){$('confirmTitle').textContent=title;$('confirmText').textContent=text;const d=$('confirmDialog');d.showModal();return new Promise(resolve=>{const done=v=>{d.close();d.oncancel=null;resolve(v);};$('confirmYes').onclick=()=>done(true);$('confirmNo').onclick=()=>done(false);d.oncancel=e=>{e.preventDefault();done(false);};});}
async function cropImage(img,snap){const r=snap.rect,sx=img.width/snap.w,sy=img.height/snap.h;const x=r.x*sx,y=r.y*sy,sw=r.w*sx,sh=r.h*sy,w=Math.max(1,Math.round(sw)),h=Math.max(1,Math.round(sh));const c=elCanvas(w,h);c.getContext('2d').drawImage(img,x,y,sw,sh,0,0,w,h);return c.toDataURL('image/png');}
async function addResult(src,snap,seed,label='NAI',diagnostics=null,scene=null){const rawSrc=src;const img=await image(src);if(!snap||![snap.w,snap.h,snap.rect?.x,snap.rect?.y,snap.rect?.w,snap.rect?.h].every(Number.isFinite)||snap.w<=0||snap.h<=0||snap.rect.w<=0||snap.rect.h<=0||snap.rect.x<0||snap.rect.y<0||snap.rect.x+snap.rect.w>snap.w||snap.rect.y+snap.rect.h>snap.h)throw Error('저장된 자르기 영역이 올바르지 않습니다.');if(!src.startsWith('data:image/png;')){const c=elCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);src=c.toDataURL('image/png');}if(Math.abs((img.width/img.height)/(snap.w/snap.h)-1)>.015)throw Error('결과 이미지와 당시 캔버스의 가로세로 비율이 다릅니다. 전체 캔버스 결과 파일을 선택하세요.');let crop=await cropImage(img,snap);if(diagnostics?.settings)crop=PNGMeta.write(crop,diagnostics.settings);const r={id:crypto.randomUUID(),baseName:baseName(),src,rawSrc,crop,snapshot:structuredClone(snap),seed,label,diagnostics,scene,time:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),upscaled:null};resultThumbs(r,img);S.results.unshift(r);S.activeResult=r;renderHistory();return r;}
function renderHistory(){const box=$('history');box.replaceChildren();S.results.forEach((r,i)=>{const b=document.createElement('button');b.className='history-card';const im=document.createElement('img');setResultImg(im,r,false);const t=document.createElement('span');t.textContent=`${r.label} · ${r.time}\n시드 ${r.seed??'외부'}`;b.append(im,t);b.onclick=()=>showResult(r);box.append(b);});$('resultCount').textContent=S.results.length;if($('galleryDialog').open)renderGallery();}
function showResult(r=S.activeResult){if(!r)return toast('아직 결과가 없어요. 생성하거나 결과 파일을 불러와주세요.');S.activeResult=r;S.viewFull=false;updateResult();if(!$('resultDialog').open)$('resultDialog').showModal();}
function updateResult(){const r=S.activeResult;if(!r)return;updateResultNav();$('resultImg').src=S.viewFull?r.src:r.crop;$('viewCrop').classList.toggle('active',!S.viewFull);$('viewFull').classList.toggle('active',S.viewFull);$('resultMeta').textContent=`${r.label} · ${r.time} · SEED ${r.seed??'외부 이미지'}`;$('downloadUp').hidden=!r.upscaled;const p=r.snapshot.rect.w*r.snapshot.rect.h;const cost=p<=1048576?1:p<=1747627?2:p<=2446678?3:4;$('upscaleHint').textContent=`메인 영역만 NAI AI 업스케일합니다. ×2 (가로·세로) · 예상 ${cost} Anlas, 최종 과금은 서버 기준. 이미지 내용이 유지되는 확대 방식입니다.`;}
function busy(b,label){S.busy=b;$('generate').disabled=b&&!S.batch;$('upscale').disabled=b;$('generate').textContent=b?label:'인페인트 생성 ↗';}
function updateAdvancedSummary(){const seed=Number($('seed').value),q=$('qualityPreset'),u=$('ucPreset');const parts=[`${$('steps').value} Steps`,`CFG ${$('guidance').value}`,seed>=0?`시드 ${seed}`:'시드 무작위',`강도 ${$('strength').value}`];if(q.value!=='none')parts.push('품질 '+q.selectedOptions[0].textContent);if(u.value!=='none')parts.push('네거티브 '+u.selectedOptions[0].textContent);$('advancedSummary').textContent='· '+parts.join(' · ');}
function updateCost(){updateAdvancedSummary();saveSettingsSoon();const px=S.w*S.h;$('pixels').textContent=`${S.w} × ${S.h} · ${(px/1000000).toFixed(2)} MP · 64px 단위`;$('promptCount').textContent=$('prompt').value.length+'자';const eligible=px<=1048576&&+$('steps').value<=28;$('costHint').textContent=eligible?'1MP / 28 Steps 이내 설정입니다. Opus 구독·V5 잔여 할당량·서버 조건에 따라 Anlas가 사용될 수 있습니다.':'일반 Opus 무료 생성 범위를 초과했습니다. Anlas가 사용될 수 있습니다.';const n=Number($('batchCount').value);if(Number.isInteger(n)&&n>1)$('costHint').textContent+=` 출력 ${n}장 = 요청 ${n}번이에요.`;$('schedule').disabled=$('model').value==='v5';$('strength').disabled=false;}
function accountUI(a){userAccount=a;S.connected=true;$('connection').textContent=a.active?(['','Tablet','Scroll','Opus'][a.tier]||'연결됨'):'연결됨';$('connection').classList.add('on');$('accountBtn').textContent='계정';$('credits').textContent=`Anlas ${a.fixed!=null&&a.purchased!=null?(Number(a.fixed)+Number(a.purchased)).toLocaleString():'조회 불가'}`;$('credits').title=`구독 ${a.fixed??'—'} / 구매 ${a.purchased??'—'}`;const u=a.usage;$('quota').textContent=u&&Number.isFinite(Number(u.percent))?`V5 ${u.isNegative?'−':''}${u.percent}%`:'V5 할당량 —';$('quota').title=u?`서버 보고 값 · 다음 1% 회복 관련 값 ${u.timeUntilNextPercent??'—'}초`:'Opus 활성 구독의 사용량이 제공될 때 표시됩니다.';}
async function refreshAccount(){if(!S.connected)return;accountUI(await call('account'));}
function captureInpaintScene(){
 const snap=snapshot(),mask=maskCanvas(true),pixels=mask.getContext('2d').getImageData(0,0,S.w,S.h).data;
 let white=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i])white++;
 if(!white)throw Error('다시 그릴 부분에 마스크를 칠해주세요.');
 const p=getParams();if(!p.prompt.trim())throw Error('프롬프트를 입력하세요.');
 const referenceTagAdded=p.referenceTag&&S.layers.some(l=>l.role==='ref')&&!p.prompt.includes('reference inset');
 if(referenceTagAdded)p.prompt+=', reference inset';
 return {format:'nai-inpaint-scene',version:2,maskGrid:8,createdAt:new Date().toISOString(),width:S.w,height:S.h,image:S.frozenInput?.image||renderBase().toDataURL('image/png'),mask:SDStudioCore.maskToDataURL(mask.getContext('2d').getImageData(0,0,S.w,S.h),S.w,S.h),params:p,snapshot:snap,maskPixels:white,referenceTagAdded};
}
async function generate(){
 // While a batch runs the generate button is a stop button: finish the current image, then stop.
 if(S.batch){S.batch.stop=true;$('generate').disabled=true;$('generate').textContent='이번 장까지만 만들고 멈춰요…';return;}
 if(S.busy)return;if(!S.connected){$('loginDialog').showModal();return;}
 const count=Number($('batchCount').value);if(!Number.isInteger(count)||count<1||count>100)throw Error('출력 개수는 1~100장으로 지정하세요.');
 const scene=captureInpaintScene(),p=scene.params,baseSeed=Number(p.seed);
 if(!await confirmAction('NAI 인페인트 씬 생성',`${scene.width} × ${scene.height} / ${p.steps} Steps / ${count}장${count>1?' (한 장씩 차례로)':''}\n전체 합성 이미지와 8픽셀 격자 마스크를 NAI에 전송합니다. 계정 조건에 따라 할당량 또는 Anlas가 소모됩니다.\nSDStudio 코드 · 강도 ${p.strength} · 추가 노이즈 0\n${p.preserveOutside?'SDStudio의 비마스크 영역 보존 옵션을 사용합니다.':'NAI가 반환한 전체 결과를 사용합니다.'}${count>1?(baseSeed>=0?`\n시드 ${baseSeed}부터 1씩 올려가며 생성합니다.`:'\n장마다 무작위 시드로 생성합니다.'):''}`))return;
 S.batch=count>1?{stop:false}:null;busy(true,'NAI 생성 중…');
 let index=0,started=Date.now(),failed=null;const made=[];
 const label=()=>count>1?`${index+1}/${count}장 · `:'';
 const timer=setInterval(()=>status(`NAI 처리 중 · ${label()}${Math.floor((Date.now()-started)/1000)}초`),1000);
 try{
  for(;index<count;index++){
   if(S.batch?.stop)break;
   if(S.batch){$('generate').classList.add('stop');$('generate').textContent=`■ 중지 · ${index+1}/${count}장 생성 중`;}
   started=Date.now();
   const sc=structuredClone(scene);if(baseSeed>=0)sc.params.seed=String((baseSeed+index)%4294967296);
   const d=await SDStudioCore.generate(sc);sc.params.seed=d.seed;
   const diagnostics={app:'Refit Canvas 1.6.3',upstream:SDStudioCore.info.commit,pipeline:'upstream-NovelAiImageGenService',settings:d.settings,request:d.request,canvas:sc.snapshot,referenceTagAdded:sc.referenceTagAdded,maskPixels:sc.maskPixels,maskGrid:8,localOriginalComposite:false};
   const r=await addResult(d.image,sc.snapshot,d.seed,count>1?`NAI ${index+1}/${count}`:'NAI',diagnostics,sc);made.push(r);
   if(p.autoCrop)download(r.crop,`${r.baseName}-${d.seed}.png`);
  }
 }catch(e){if(!made.length)throw e;failed=e;}
 finally{clearInterval(timer);S.batch=null;$('generate').classList.remove('stop');busy(false);refreshAccount().catch(()=>{});}
 if(!made.length)return status('생성 취소됨');
 status(count>1?`완료 · ${made.length}/${count}장 생성`:'완료 · 씬 생성 및 메인 잘라내기');showResult(made.at(-1));
 if(failed)toast(`${made.length}장 만든 뒤 오류로 멈췄어요 · ${failed.message}`,true);else if(made.length<count)toast(`${made.length}장 만들고 멈췄어요.`);else if(count>1)toast(`${count}장 생성 완료 · 아래 결과 목록에서 하나씩 볼 수 있어요.`);
}
async function upscale(){const r=S.activeResult;if(!r||S.busy)return;if(!S.connected)return toast('먼저 NAI 토큰으로 연결하세요.',true);const im=await image(r.crop),px=im.width*im.height;if(px>3145728)throw Error('업스케일 입력은 3,145,728픽셀 이하만 지원합니다.');const cost=px<=1048576?1:px<=1747627?2:px<=2446678?3:4;if(!await confirmAction('메인 이미지 AI 업스케일',`${im.width} × ${im.height} → ${im.width*2} × ${im.height*2}\n예상 ${cost} Anlas가 사용됩니다. 최종 과금은 NAI 서버 기준입니다.`))return;busy(true,'업스케일 중…');try{const d=await SDStudioCore.upscale(r.crop);r.upscaled=d.image;if(S.activeResult===r){updateResult();$('resultImg').src=r.upscaled;}$('upscaleHint').textContent=`업스케일 완료 · ${d.width} × ${d.height}`;download(r.upscaled,`${r.baseName||baseName()}-${r.seed??'import'}-upscaled.png`);toast('업스케일 완료');}finally{busy(false);refreshAccount().catch(()=>{});}}
// UI wiring
$('addMain').onclick=()=> $('mainFile').click();$('emptyAdd').onclick=$('addMain').onclick;$('addRefs').onclick=()=>$('refsFile').click();$('mainOnly').onchange=safe(async()=>{if(!$('mainOnly').checked){const m=main();if(m)m.locked=false;layersUI();return;}const refs=S.layers.filter(l=>l.role==='ref').length,masked=S.strokes.length>0;if((refs||masked)&&!await confirmAction('메인 이미지만 수정',`캔버스를 메인 이미지에 맞춥니다.${refs?`\n레퍼런스 ${refs}장은 빠집니다.`:''}${masked?'\n지금 칠한 마스크는 지워집니다.':''}`)){$('mainOnly').checked=false;layersUI();return;}S.layers=S.layers.filter(l=>l.role!=='ref');if(main()){S.strokes=[];S.redo=[];}applyMainOnly();layersUI();if(main())toast(`메인 이미지만 수정 · 캔버스 ${S.w} × ${S.h}`);});
$('mainFile').onchange=safe(async e=>{if(e.target.files[0])await addFile(e.target.files[0],'main');e.target.value='';});$('refsFile').onchange=safe(async e=>{for(const f of e.target.files)await addFile(f,'ref');e.target.value='';});$('stage').ondragover=e=>{e.preventDefault();};$('stage').ondrop=safe(async e=>{e.preventDefault();for(const f of e.dataTransfer.files)await addFile(f,$('mainOnly').checked||!main()?'main':'ref');});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));$('zoomFit').onclick=fit;$('zoomIn').onclick=()=>zoom(S.zoom*1.2);$('zoomOut').onclick=()=>zoom(S.zoom/1.2);$('fitMain').onclick=fitMain;$('arrange').onclick=arrange;$('brushSize').oninput=()=>{$('brushLabel').textContent=$('brushSize').value+'px';draw();};$('brushShape').onchange=draw;$('showMask').onchange=draw;$('undoMask').onclick=undo;$('redoMask').onclick=redo;$('fillMask').onclick=()=>{if(!main())return;const m=S.frozenInput?.snapshot.rect||main();S.strokes.push({space:'canvas',fill:true,rect:{x:m.x,y:m.y,w:m.w,h:m.h}});S.redo=[];draw();};$('clearMask').onclick=()=>{S.strokes.push({space:'canvas',fill:true,erase:true,rect:{x:0,y:0,w:S.w,h:S.h}});S.redo=[];draw();};
$('preset').onchange=()=>{if($('preset').value!=='custom'){[$('cw').value,$('ch').value]=$('preset').value.split(',');}};
$('applySize').onclick=safe(()=>{const w=+$('cw').value,h=+$('ch').value;if(!Number.isInteger(w)||!Number.isInteger(h)||w<64||h<64||w%64||h%64||w>4096||h>4096||w*h>3145728)throw Error('가로·세로를 64의 배수로 지정하세요. 최대 3,145,728픽셀입니다.');S.w=w;S.h=h;fit();updateCost();toast('캔버스 변경 · 이미지 위치는 유지됩니다. 필요하면 좌측 맞춤을 눌러주세요.');});
for(const id of ['ix','iy','iw','ih'])$(id).onchange=safe(()=>{const l=selected(),v=+$(id).value;if(!l||l.locked)return;if(!Number.isFinite(v))throw Error('숫자를 입력하세요.');if(id==='ix')l.x=v;else if(id==='iy')l.y=v;else{if(v<8||v>20000)throw Error('이미지 크기는 8~20000px입니다.');if(id==='iw'){l.w=v;l.h=v*l.img.height/l.img.width;}else{l.h=v;l.w=v*l.img.width/l.img.height;}}updateInspector();draw();});
$('deleteLayer').onclick=()=>{const l=selected();if(!l||l.locked)return;S.layers=S.layers.filter(x=>x!==l);S.selected=main()?.id||null;if(l.role==='main'){S.strokes=[];S.redo=[];}layersUI();};$('duplicate').onclick=()=>{const l=selected();if(!l||l.role==='main'||S.layers.length>=32)return;const n={...l,id:crypto.randomUUID(),x:l.x+20,y:l.y+20,locked:false};S.layers.push(n);S.selected=n.id;layersUI();};
$('exportCanvas').onclick=safe(()=>{S.lastExport=snapshot();download(renderBase().toDataURL('image/png'),`${baseName()}-canvas.png`);toast('이 배치를 기억했어요. NAI 결과를 불러오면 같은 메인 영역을 자릅니다.');});$('exportMask').onclick=()=>download(SDStudioCore.maskToDataURL(maskCanvas().getContext('2d').getImageData(0,0,S.w,S.h),S.w,S.h),`${baseName()}-mask.png`);$('importResult').onclick=()=>$('resultFile').click();$('resultFile').onchange=safe(async e=>{const f=e.target.files[0];if(!f)return;const snap=S.lastExport||snapshot();const r=await addResult(await fileData(f),snap,null,'불러옴');showResult(r);e.target.value='';});$('openResults').onclick=()=>showResult();$('viewCrop').onclick=()=>{S.viewFull=false;updateResult();};$('viewFull').onclick=()=>{S.viewFull=true;updateResult();};$('downloadCrop').onclick=()=>download(S.activeResult.crop,`${S.activeResult.baseName||baseName()}-${S.activeResult.seed??'import'}.png`);$('downloadFull').onclick=()=>download(S.activeResult.src,`${S.activeResult.baseName||baseName()}-canvas-${S.activeResult.seed??'import'}.png`);$('downloadUp').onclick=()=>download(S.activeResult.upscaled,`${S.activeResult.baseName||baseName()}-${S.activeResult.seed??'import'}-upscaled.png`);$('useSeed').onclick=()=>{const r=S.activeResult;if(r.seed==null)return toast('외부 이미지의 시드가 없습니다.');$('seed').value=r.seed;toast('시드를 적용했습니다.');};$('reuseResult').onclick=safe(async()=>{const r=S.activeResult,img=await image(r.crop);let l=main();if(!l){l={id:crypto.randomUUID(),role:'main',x:0,y:0,locked:false};S.layers.unshift(l);}const oldW=S.frozenInput?S.frozenInput.snapshot.rect.w:l.w;if(S.frozenInput){l.x=S.frozenInput.snapshot.rect.x;l.y=S.frozenInput.snapshot.rect.y;S.frozenInput=null;S.maskBase=null;l.locked=false;S.layers=[l];}l.src=r.crop;l.img=img;l.name='수정된 메인';if(oldW){l.w=oldW;l.h=oldW*img.height/img.width;}else{l.w=img.width;l.h=img.height;fitMain();}S.strokes=[];S.redo=[];S.selected=l.id;layersUI();applyMainOnly();$('resultDialog').close();});
$('generate').onclick=safe(generate);$('upscale').onclick=safe(upscale);$('accountBtn').onclick=()=>$('loginDialog').showModal();$('refreshAccount').onclick=safe(refreshAccount);$('login').onclick=safe(async()=>{$('login').disabled=true;$('loginMessage').textContent='토큰 확인 중…';try{accountUI(await call('login',{token:$('token').value,remember:$('remember').checked}));$('token').value='';$('loginMessage').textContent='연결 완료';$('loginDialog').close();toast('NovelAI에 연결했습니다.');}catch(e){$('loginMessage').textContent=e.message;throw e;}finally{$('login').disabled=false;}});$('logout').onclick=safe(async()=>{await call('logout');S.connected=false;userAccount=null;$('token').value='';$('connection').textContent='연결 전';$('connection').classList.remove('on');$('credits').textContent='Anlas —';$('quota').textContent='V5 할당량 —';$('accountBtn').textContent='토큰 연결';$('loginDialog').close();toast('토큰을 지우고 연결을 해제했습니다.');});
params.forEach(k=>$(k).addEventListener('input',updateCost));
$('saveProject').onclick=()=>{const d={format:'nairef',version:4,w:S.w,h:S.h,layers:S.layers.map(({img,thumb,thumbImg,...l})=>l),strokes:S.strokes,params:getParams(),lastExport:S.lastExport,frozenInput:S.frozenInput,results:S.results.map(({thumb,thumbFull,...r})=>r),mainOnly:$('mainOnly').checked};downloadJSON(d,`${baseName()}.nairef`);toast('프로젝트 저장 완료');};$('loadProject').onclick=()=>$('projectFile').click();
$('projectFile').onchange=safe(async e=>{const f=e.target.files[0];if(!f)return;if(f.size>100*1024*1024)throw Error('프로젝트는 100MB 이하만 열 수 있습니다.');const d=JSON.parse(await f.text());if(d.format!=='nairef'||![1,2,3,4].includes(d.version)||!Array.isArray(d.layers)||d.layers.length>32||!Number.isInteger(d.w)||!Number.isInteger(d.h)||d.w<64||d.h<64||d.w%64||d.h%64||d.w*d.h>3145728)throw Error('지원하지 않는 프로젝트입니다.');if(d.layers.filter(l=>l.role==='main').length>1)throw Error('메인 이미지가 여러 개입니다.');const ls=[];for(const l of d.layers){if(!['main','ref'].includes(l.role)||!['x','y','w','h'].every(k=>Number.isFinite(l[k]))||l.w<8||l.h<8)throw Error('이미지 배치 정보가 잘못되었습니다.');const img=await image(l.src);ls.push({...l,id:crypto.randomUUID(),img,h:l.w*img.height/img.width,baseName:l.baseName||(l.role==='main'&&!['수정된 메인','입력 씬 · 원본 배치 고정'].includes(l.name)?stem(l.name):stem(f.name))||'refit'});}if(!Array.isArray(d.strokes)||d.strokes.length>20000)throw Error('마스크 데이터가 잘못되었습니다.');for(const s of d.strokes){if(s.fill)continue;if(!['round','square'].includes(s.shape)||!Number.isFinite(s.size)||s.size<=0||s.size>(s.space==='canvas'?10000:100)||!Array.isArray(s.points)||s.points.length>100000||!s.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))throw Error('마스크 점 정보가 잘못되었습니다.');}const results=[];for(const r of (d.results||[]).slice(0,50)){await image(r.src);await image(r.crop);if(r.upscaled)await image(r.upscaled);const q=r.snapshot;if(!q||![q.w,q.h,q.rect?.x,q.rect?.y,q.rect?.w,q.rect?.h].every(Number.isFinite))throw Error('결과 자르기 정보가 잘못되었습니다.');results.push(r);}const frozen=d.frozenInput?await validateInputScene({...d.frozenInput,width:d.w,height:d.h}):null;S.frozenInput=frozen?.input||null;S.maskBase=frozen?.maskBase||null;S.w=d.w;S.h=d.h;S.layers=ls;S.selected=main()?.id||ls[0]?.id;S.strokes=d.strokes.map(s=>toCanvasStroke(s,main())).filter(Boolean);S.redo=[];S.results=results;S.activeResult=results[0]||null;S.lastExport=d.lastExport||null;$('mainOnly').checked=d.mainOnly===true;setParams({qualityHint:0,ucHint:0,...d.params,...(d.version<3?{referenceTag:false,inpaintMode:'scene',preserveOutside:true}:{})});$('cw').value=S.w;$('ch').value=S.h;layersUI();renderHistory();fit();updateCost();toast('프로젝트 불러오기 완료');e.target.value='';});
window.addEventListener('beforeunload',e=>{if(S.layers.length&&document.querySelector('meta[name="desktop-mode"]')?.content!=='true'){e.preventDefault();e.returnValue='';}});
new ResizeObserver(()=>{if(!drag)fit();}).observe($('stage'));
/* ---- 1.6: result navigation · gallery · remembered settings · save folder · update notice · image crop/erase ---- */
// Results are newest-first, same order as the history strip: ← goes left in that strip, → goes right.
function stepResult(d){const i=S.results.indexOf(S.activeResult);const n=i<0?null:S.results[i+d];if(n)showResult(n);}
function updateResultNav(){const i=S.results.indexOf(S.activeResult),n=S.results.length;$('resultPos').textContent=i<0?'':`${i+1} / ${n}`;$('prevResult').disabled=i<=0;$('nextResult').disabled=i<0||i>=n-1;}
$('prevResult').onclick=()=>stepResult(-1);$('nextResult').onclick=()=>stepResult(1);
$('resultDialog').addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();stepResult(-1);}else if(e.key==='ArrowRight'){e.preventDefault();stepResult(1);}});
$('resultDialog').addEventListener('close',()=>{if($('galleryDialog').open)renderGallery();});

function renderGallery(){
 const g=$('galleryGrid'),full=$('galleryFull').checked;g.replaceChildren();$('galleryMeta').textContent=`${S.results.length}장`;
 if(!S.results.length){const p=document.createElement('p');p.className='hint';p.textContent='아직 결과가 없어요.';g.append(p);return;}
 for(const r of S.results){const b=document.createElement('button');b.className='gallery-card'+(r===S.activeResult?' active':'');const im=document.createElement('img');im.loading='lazy';setResultImg(im,r,full);const t=document.createElement('span');t.textContent=`${r.label} · ${r.time} · 시드 ${r.seed??'외부'}`;b.append(im,t);b.onclick=()=>showResult(r);g.append(b);}
}
function setGallerySize(v){v=Math.max(90,Math.min(520,Math.round(v/10)*10));$('gallerySize').value=v;$('gallerySizeLabel').textContent=v+'px';$('galleryGrid').style.setProperty('--thumb',v+'px');}
$('openGallery').onclick=()=>{renderGallery();if(!$('galleryDialog').open)$('galleryDialog').showModal();};
$('gallerySize').oninput=()=>{setGallerySize(+$('gallerySize').value);saveSettingsSoon();};
$('galleryFull').onchange=()=>{renderGallery();saveSettingsSoon();};
$('galleryGrid').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();setGallerySize(+$('gallerySize').value+(e.deltaY<0?20:-20));saveSettingsSoon();},{passive:false});
setGallerySize(200);

// Remembered settings live in the local engine (settings.json), not in browser storage:
// the desktop window gets a new localhost port every launch.
var settingsReady=false,settingsTimer=null;
function collectSettings(){return {v:1,params:getParams(),autoPrompt:$('autoPrompt').checked,batchCount:$('batchCount').value,advancedOpen:$('advanced').open,mainOnly:$('mainOnly').checked,canvas:[S.w,S.h],brushSize:+$('brushSize').value,brushShape:$('brushShape').value,showMask:$('showMask').checked,gallerySize:+$('gallerySize').value,galleryFull:$('galleryFull').checked};}
function saveSettingsSoon(){if(!settingsReady)return;clearTimeout(settingsTimer);settingsTimer=setTimeout(()=>{call('settings',{action:'save',data:collectSettings()}).catch(()=>{});},700);}
async function loadSettings(){
 try{
  const s=(await call('settings',{action:'load'})).data;if(!s||s.v!==1)return;
  if(s.params&&typeof s.params==='object')setParams(Object.fromEntries(Object.entries(s.params).filter(([k])=>params.includes(k))));
  if(typeof s.autoPrompt==='boolean')$('autoPrompt').checked=s.autoPrompt;
  const n=Number(s.batchCount);if(Number.isInteger(n)&&n>=1&&n<=100)$('batchCount').value=n;
  $('advanced').open=s.advancedOpen===true;
  if(typeof s.mainOnly==='boolean')$('mainOnly').checked=s.mainOnly;
  const [w,h]=Array.isArray(s.canvas)?s.canvas.map(Number):[];
  if(!S.layers.length&&Number.isInteger(w)&&Number.isInteger(h)&&w>=64&&h>=64&&!(w%64)&&!(h%64)&&w<=4096&&h<=4096&&w*h<=3145728){S.w=w;S.h=h;$('cw').value=w;$('ch').value=h;$('preset').value=[...$('preset').options].some(o=>o.value===`${w},${h}`)?`${w},${h}`:'custom';}
  const b=Number(s.brushSize);if(b>=+$('brushSize').min&&b<=+$('brushSize').max){$('brushSize').value=b;$('brushLabel').textContent=b+'px';}
  if(['round','square'].includes(s.brushShape))$('brushShape').value=s.brushShape;
  if(typeof s.showMask==='boolean')$('showMask').checked=s.showMask;
  if(Number.isFinite(s.gallerySize))setGallerySize(s.gallerySize);
  if(typeof s.galleryFull==='boolean')$('galleryFull').checked=s.galleryFull;
  layersUI();fit();updateCost();
 }catch{}finally{settingsReady=true;}
}
for(const ev of ['input','change'])document.addEventListener(ev,e=>{if(e.target.closest?.('#imageEditDialog,#loginDialog,#confirmDialog')||e.target.type==='file')return;saveSettingsSoon();},true);

// Desktop extras (only in the Electron window): save folder and new-version notice.
const desk=window.refitDesktop;
function showSaveState(s){if(!s)return;$('saveMode').value=s.mode;$('saveFolderLabel').textContent=s.mode==='folder'?'폴더: '+s.folder:(s.lastSaveDir?'저장 창은 마지막 저장 위치에서 열려요: '+s.lastSaveDir:'저장 창은 마지막으로 저장한 위치를 기억해요.');$('openFolder').disabled=!s.folder;}
// In the desktop window, file pickers go through the app so the open folder is remembered (separately from saves).
const PICK_TITLES={mainFile:'메인 이미지 열기',refsFile:'레퍼런스 이미지 열기 (여러 장 가능)',projectFile:'프로젝트 열기',sceneFile:'입력 씬 열기',resultFile:'NAI 결과 불러오기',settingsFile:'생성 설정을 읽을 NAI PNG'};
const mimeOf=n=>({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json',nairef:'application/json'})[String(n).toLowerCase().split('.').pop()]||'';
async function pickWithDesktop(input){try{const list=await desk.pickFiles({accept:input.accept,multiple:input.multiple,title:PICK_TITLES[input.id]});if(!list?.length)return;const dt=new DataTransfer();for(const f of list)dt.items.add(new File([f.data],f.name,{type:mimeOf(f.name)}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){toast(String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);}}
if(desk){
 $('saveBox').hidden=false;desk.getSaveState().then(showSaveState).catch(()=>{});
 document.addEventListener('click',e=>{const t=e.target;if(t instanceof HTMLInputElement&&t.type==='file'){e.preventDefault();pickWithDesktop(t);}},true);
 $('saveMode').onchange=safe(async()=>{let s=await desk.setSaveMode($('saveMode').value);if($('saveMode').value==='folder'&&s.mode!=='folder')s=await desk.pickSaveFolder();showSaveState(s);if(s.mode==='folder')toast('이제 저장할 때 창 없이 이 폴더에 바로 저장해요.');});
 $('pickFolder').onclick=safe(async()=>{const s=await desk.pickSaveFolder();showSaveState(s);if(s.mode==='folder')toast('이제 저장할 때 창 없이 이 폴더에 바로 저장해요.');});
 $('openFolder').onclick=()=>desk.openSaveFolder();
 desk.onSaved(info=>{if(!info.folderMode){if(info.ok)desk.getSaveState().then(showSaveState).catch(()=>{});return;}if(info.ok)toast('저장했어요 · '+String(info.path).split(/[\\/]/).pop());else toast('저장하지 못했어요. 폴더를 확인하세요.',true);});
 desk.onUpdate(info=>{const b=$('updateBanner');b.textContent=`새 버전 ${info.version} 나왔어요 ↗`;b.title=`지금 버전 ${info.current} · 누르면 다운로드 페이지를 엽니다`;b.hidden=false;b.onclick=()=>desk.openReleasePage();});
}

// Image crop / erase for a placed image (main or reference). Cropping keeps the kept area where it was on the canvas.
const IE={layer:null,orig:null,work:null,undo:[],tool:'crop',rect:null,drag:null,cursor:null,off:{x:0,y:0},changed:false};
const ieCv=$('ieCanvas'),ieCtx=ieCv.getContext('2d');
const IE_HINT={crop:'남길 부분을 드래그해서 고르고 Enter나 적용을 누르세요. 잘라도 캔버스 위 위치는 그대로예요.',erase:'드래그한 곳을 투명하게 지웁니다. 지운 자리는 캔버스에서 흰 배경으로 보여요.',eraseRect:'드래그한 네모 영역을 통째로 지웁니다. 얼굴 같은 걸 가릴 때 편해요.'};
function ieCopy(c){const d=elCanvas(c.width,c.height);d.getContext('2d').drawImage(c,0,0);return d;}
function iePush(){IE.undo.push({c:ieCopy(IE.work),off:{...IE.off}});if(IE.undo.length>40)IE.undo.shift();}
function ieTool(t){IE.tool=t;IE.rect=null;document.querySelectorAll('[data-ie-tool]').forEach(b=>b.classList.toggle('active',b.dataset.ieTool===t));$('ieBrushBox').hidden=t!=='erase';$('ieHint').textContent=IE_HINT[t];ieDraw();}
function ieInfo(){$('ieInfo').textContent=`${IE.layer.role==='main'?'메인':'레퍼런스'} · ${IE.work.width} × ${IE.work.height}`;}
function ieDraw(){
 if(!IE.work)return;if(ieCv.width!==IE.work.width||ieCv.height!==IE.work.height){ieCv.width=IE.work.width;ieCv.height=IE.work.height;}
 ieCtx.clearRect(0,0,ieCv.width,ieCv.height);ieCtx.drawImage(IE.work,0,0);
 const k=ieCv.width/Math.max(1,ieCv.getBoundingClientRect().width||ieCv.width),r=IE.rect;
 if(r&&r.w>0&&r.h>0){ieCtx.save();if(IE.tool==='crop'){ieCtx.fillStyle='rgba(10,12,18,.6)';ieCtx.beginPath();ieCtx.rect(0,0,ieCv.width,ieCv.height);ieCtx.rect(r.x,r.y,r.w,r.h);ieCtx.fill('evenodd');}else{ieCtx.fillStyle='rgba(238,114,173,.35)';ieCtx.fillRect(r.x,r.y,r.w,r.h);}ieCtx.strokeStyle='#b8adff';ieCtx.lineWidth=2*k;ieCtx.setLineDash([8*k,5*k]);ieCtx.strokeRect(r.x,r.y,r.w,r.h);ieCtx.restore();}
 if(IE.tool==='erase'&&IE.cursor){ieCtx.save();ieCtx.strokeStyle='#cf3d87';ieCtx.lineWidth=1.5*k;ieCtx.beginPath();ieCtx.arc(IE.cursor.x,IE.cursor.y,ieBrush()/2,0,Math.PI*2);ieCtx.stroke();ieCtx.restore();}
 ieInfo();
}
function iePoint(e){const b=ieCv.getBoundingClientRect();return {x:(e.clientX-b.left)*ieCv.width/b.width,y:(e.clientY-b.top)*ieCv.height/b.height};}
function ieBrush(){const b=ieCv.getBoundingClientRect();return +$('ieBrush').value*ieCv.width/Math.max(1,b.width);}
function ieClampRect(a,b){const x0=Math.max(0,Math.min(a.x,b.x)),y0=Math.max(0,Math.min(a.y,b.y)),x1=Math.min(IE.work.width,Math.max(a.x,b.x)),y1=Math.min(IE.work.height,Math.max(a.y,b.y));return {x:x0,y:y0,w:Math.max(0,x1-x0),h:Math.max(0,y1-y0)};}
function ieErase(a,b){const g=IE.work.getContext('2d');g.save();g.globalCompositeOperation='destination-out';g.lineCap='round';g.lineJoin='round';g.lineWidth=ieBrush();g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x+.01,b.y);g.stroke();g.restore();IE.changed=true;}
function ieCrop(){const r=IE.rect;if(!r)return false;const x=Math.round(r.x),y=Math.round(r.y),w=Math.round(r.x+r.w)-x,h=Math.round(r.y+r.h)-y;if(w<8||h<8){toast('8픽셀보다 크게 골라주세요.',true);return false;}iePush();const c=elCanvas(w,h);c.getContext('2d').drawImage(IE.work,x,y,w,h,0,0,w,h);IE.work=c;IE.off.x+=x;IE.off.y+=y;IE.rect=null;IE.changed=true;ieDraw();return true;}
ieCv.addEventListener('pointerdown',e=>{if(e.button!==0||!IE.work)return;ieCv.setPointerCapture(e.pointerId);const p=iePoint(e);if(IE.tool==='erase'){iePush();ieErase(p,p);IE.drag={type:'erase',last:p};}else{IE.drag={type:'rect',start:p};IE.rect={x:p.x,y:p.y,w:0,h:0};}ieDraw();});
ieCv.addEventListener('pointermove',e=>{if(!IE.work)return;const p=iePoint(e);IE.cursor=p;if(IE.drag?.type==='erase'){ieErase(IE.drag.last,p);IE.drag.last=p;}else if(IE.drag?.type==='rect')IE.rect=ieClampRect(IE.drag.start,p);ieDraw();});
ieCv.addEventListener('pointerleave',()=>{IE.cursor=null;ieDraw();});
ieCv.addEventListener('pointerup',()=>{const d=IE.drag;IE.drag=null;if(d?.type!=='rect')return;const r=IE.rect;if(!r||r.w<2||r.h<2){IE.rect=null;ieDraw();return;}if(IE.tool==='eraseRect'){iePush();IE.work.getContext('2d').clearRect(Math.floor(r.x),Math.floor(r.y),Math.ceil(r.w)+1,Math.ceil(r.h)+1);IE.rect=null;IE.changed=true;}ieDraw();});
document.querySelectorAll('[data-ie-tool]').forEach(b=>b.onclick=()=>ieTool(b.dataset.ieTool));
$('ieBrush').oninput=()=>{$('ieBrushLabel').textContent=$('ieBrush').value+'px';ieDraw();};
$('ieUndo').onclick=()=>{const u=IE.undo.pop();if(!u)return toast('되돌릴 작업이 없어요.');IE.work=u.c;IE.off=u.off;IE.rect=null;IE.changed=IE.undo.length>0;ieDraw();};
$('ieReset').onclick=()=>{if(!IE.orig)return;iePush();const c=elCanvas(IE.orig.width,IE.orig.height);c.getContext('2d').drawImage(IE.orig,0,0);IE.work=c;IE.off={x:0,y:0};IE.rect=null;IE.changed=false;ieDraw();};
$('ieCancel').onclick=()=>$('imageEditDialog').close();
$('imageEditDialog').addEventListener('keydown',e=>{if(e.key==='Enter'&&IE.tool==='crop'&&IE.rect){e.preventDefault();ieCrop();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('ieUndo').click();}});
$('imageEditDialog').addEventListener('close',()=>{IE.work=null;IE.layer=null;IE.orig=null;IE.undo=[];});
function openImageEditor(l){if(!l)return toast('편집할 이미지를 먼저 고르세요.');if(S.frozenInput)return toast('입력 씬에서는 이미지를 바꿀 수 없어요.',true);IE.layer=l;IE.orig=l.img;IE.work=elCanvas(l.img.width,l.img.height);IE.work.getContext('2d').drawImage(l.img,0,0);IE.undo=[];IE.rect=null;IE.drag=null;IE.off={x:0,y:0};IE.changed=false;$('imageEditDialog').showModal();ieTool('crop');requestAnimationFrame(ieDraw);}
$('ieApply').onclick=safe(async()=>{
 if(IE.tool==='crop'&&IE.rect&&!ieCrop())return;
 const l=IE.layer;if(!l)return;if(!IE.changed){$('imageEditDialog').close();return;}
 const src=IE.work.toDataURL('image/png'),img=await image(src),scale=l.w/IE.orig.width,cropped=IE.off.x||IE.off.y||img.width!==IE.orig.width||img.height!==IE.orig.height;
 l.x+=IE.off.x*scale;l.y+=IE.off.y*scale;l.w=img.width*scale;l.h=img.height*scale;l.src=src;l.img=img;
 let note='이미지를 고쳤어요.';
 if(l.role==='main'&&cropped&&$('mainOnly').checked){if(S.strokes.length){S.strokes=[];S.redo=[];note='메인을 잘라서 캔버스를 다시 맞췄어요. 칠한 마스크는 지웠어요.';}else note='메인을 잘라서 캔버스를 다시 맞췄어요.';applyMainOnly();}
 $('imageEditDialog').close();layersUI();toast(note);
});
$('editImage').onclick=()=>openImageEditor(selected());
(async()=>{updateCost();fit();await loadSettings();try{const d=await call('state');$('remember').disabled=!d.canRemember;S.connected=d.connected;if(d.connected)await refreshAccount();}catch(e){status(e.message);}})();

$('importSettings').onclick=()=>$('settingsFile').click();
$('settingsFile').onchange=safe(async e=>{const f=e.target.files[0];if(!f)return;const src=await fileData(f),result=await PNGMeta.read(src),p=PNGMeta.form(result);if(!await confirmAction('PNG 생성 설정 적용',`프롬프트·네거티브·시드·Steps·가이던스·샘플러와 인페인트 옵션을 불러옵니다.\n현재 이미지 배치와 마스크는 유지됩니다. 추가 노이즈는 0, 투명 배경은 끔으로 고정합니다.\n${result.settings.width??'?'} × ${result.settings.height??'?'} / ${p.steps} Steps / 시드 ${p.seed}`))return;setParams(p);toast('SDStudio 설정 적용 · 이미 들어간 프리셋 태그는 한 번 분리해 중복을 막습니다.');e.target.value='';});
$('downloadSettings').onclick=()=>{const r=S.activeResult;if(!r?.diagnostics)return toast('이전 버전 또는 외부 결과에는 요청 기록이 없습니다.');downloadJSON(r.diagnostics,`${r.baseName||baseName()}-${r.seed??'import'}-settings.json`);};

$('resetInpaint').onclick=()=>{setParams({strength:1,preserveOutside:true,referenceTag:false});toast('인페인트 기본값 · 강도 1 · 추가 노이즈 0 · 원본 보존');};
$('downloadRaw').onclick=()=>{const r=S.activeResult;if(r)download(r.rawSrc||r.src,`${r.baseName||baseName()}-${r.seed??'import'}-server.png`);};
$('downloadScene').onclick=()=>{const r=S.activeResult;if(!r?.scene)return toast('이전 결과 또는 외부 파일에는 입력 씬이 없습니다.');downloadJSON({...r.scene,request:r.diagnostics?.request},`${r.baseName||baseName()}-scene-${r.seed}.json`);};

$('model').addEventListener('change',()=>{updateCost();});
for(const ev of ['input','change'])$('advanced').addEventListener(ev,updateAdvancedSummary);$('batchCount').addEventListener('input',updateCost);

// An exported input scene reopens without recomposing/re-encoding its source.
// Only the mask may be edited; opening a new main image returns to layer editing.
function frozenUI(){
 const on=!!S.frozenInput;
 for(const id of ['addRefs','arrange','fitMain','applySize','ix','iy','iw','ih','duplicate','deleteLayer','editImage'])$(id).disabled=on;
 const only=$('mainOnly').checked&&!on;$('mainOnly').disabled=on;$('mainOnlyHint').hidden=!only;
 for(const id of ['cw','ch','preset'])$(id).disabled=only;if(only)for(const id of ['addRefs','arrange','fitMain','applySize'])$(id).disabled=true;
 $('importScene').textContent=on?'다른 입력 씬 열기':'입력 씬 열기';
}
async function validateInputScene(d){
 if(!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<64||d.height<64||d.width%64||d.height%64||d.width*d.height>3145728)throw Error('입력 씬의 해상도가 올바르지 않습니다.');
 const snap=d.snapshot,r=snap?.rect;
 if(!r||snap.w!==d.width||snap.h!==d.height||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>snap.w||r.y+r.h>snap.h)throw Error('입력 씬의 메인 영역이 올바르지 않습니다.');
 const [base,mask]=await Promise.all([image(d.image),image(d.mask)]);
 if(base.width!==d.width||base.height!==d.height||mask.width!==d.width||mask.height!==d.height)throw Error('입력 씬의 이미지·마스크 크기가 다릅니다.');
 const c=elCanvas(d.width,d.height),g=c.getContext('2d');g.drawImage(mask,0,0);const pixels=g.getImageData(0,0,c.width,c.height);
 for(let i=0;i<pixels.data.length;i+=4){const v=pixels.data[i];if(![0,255].includes(v)||pixels.data[i+1]!==v||pixels.data[i+2]!==v||pixels.data[i+3]!==255)throw Error('불투명한 흑백 이진 마스크가 필요합니다.');if(v===0)pixels.data[i+3]=0;}
 g.putImageData(SDStudioCore.normalizeMaskData(pixels,d.width,d.height,true),0,0);
 return {input:{image:d.image,mask:d.mask,snapshot:structuredClone(snap)},maskBase:c,base};
}
$('importScene').onclick=()=>$('sceneFile').click();
$('sceneFile').onchange=safe(async e=>{
 const f=e.target.files[0];if(!f)return;if(f.size>70*1024*1024)throw Error('씬 파일은 70MB 이하여야 합니다.');
 const d=JSON.parse(await f.text());if(d.format!=='nai-inpaint-scene'||![1,2].includes(d.version))throw Error('입력·마스크·설정 저장으로 만든 JSON이 필요합니다.');
 const v=await validateInputScene(d);
 S.w=d.width;S.h=d.height;S.frozenInput=v.input;S.maskBase=v.maskBase;
 const l={id:crypto.randomUUID(),role:'main',name:'입력 씬 · 원본 배치 고정',baseName:stem(f.name).replace(/-scene-\d+$/,'')||'refit',src:d.image,img:v.base,x:0,y:0,w:S.w,h:S.h,locked:true};
 S.layers=[l];S.selected=l.id;S.strokes=[];S.redo=[];S.lastExport=structuredClone(d.snapshot);S.results=[];S.activeResult=null;
 setParams({qualityHint:0,ucHint:0,...d.params});$('cw').value=S.w;$('ch').value=S.h;layersUI();renderHistory();fit();updateCost();setTool('brush');
 toast('입력 이미지를 열었어요. 마스크는 8픽셀 격자에 맞춰 표시·전송합니다.');e.target.value='';
});
