// Run from source/: npm ci --ignore-scripts && npm run test:mask
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{createRequire}=require('node:module');
const fromSource=createRequire(path.resolve(__dirname,'../source/package.json'));
const esbuild=fromSource('esbuild');
const text=esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../source/vendor/SDStudio/src/renderer/models/focusedInpaint.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const scope={exports:{}};new Function('module','exports',text)(scope,scope.exports);
const {snapMaskToGrid}=scope.exports;
function partialCells(data,w,h){let n=0;for(let by=0;by<h;by+=8)for(let bx=0;bx<w;bx+=8){let selected=0,total=0;for(let y=by;y<Math.min(by+8,h);y++)for(let x=bx;x<Math.min(bx+8,w);x++){selected+=data[y*w+x];total++;}if(selected&&selected!==total)n++;}return n;}
test('arbitrary curved boundary becomes complete 8px cells, retaining all selected pixels',()=>{
 const w=1216,h=832,m=new Uint8Array(w*h);for(let y=273;y<h;y++){const edge=Math.min(720,Math.round(540+70*Math.sin(y/45)));m.fill(1,y*w+37,y*w+edge);}
 assert(partialCells(m,w,h)>0);const out=snapMaskToGrid(m,w,h);assert.equal(partialCells(out,w,h),0);
 for(let i=0;i<m.length;i++)if(m[i])assert.equal(out[i],1);
 assert.deepEqual(snapMaskToGrid(out,w,h),out);
});
test('empty, full and canvas corners preserve mask polarity',()=>{
 const w=64,h=64;assert.equal(snapMaskToGrid(new Uint8Array(w*h),w,h).some(Boolean),false);
 assert.equal(snapMaskToGrid(new Uint8Array(w*h).fill(1),w,h).every(Boolean),true);
 const m=new Uint8Array(w*h);m[0]=m[w*h-1]=1;const out=snapMaskToGrid(m,w,h);assert.equal(out.reduce((a,b)=>a+b,0),128);assert.equal(out[9*w+9],0);
});
test('odd-sized edge cells remain in bounds',()=>{
 const m=new Uint8Array(13*11);m[m.length-1]=1;const out=snapMaskToGrid(m,13,11);assert.equal(out.length,m.length);assert.equal(out.reduce((a,b)=>a+b,0),15);assert.equal(partialCells(out,13,11),0);
});
