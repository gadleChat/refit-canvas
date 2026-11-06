'use strict';
const {app,BrowserWindow,Menu,dialog,session,ipcMain,shell,net}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
let mainWindow,backend,origin='',stopping=false;
app.setName('Refit Canvas');
app.setAppUserModelId('local.refitcanvas');
// Files remain under a stable per-user location between portable releases.
app.setPath('userData',path.join(app.getPath('appData'),'RefitCanvas'));

const RELEASES='https://github.com/gadleChat/refit-canvas/releases';
// Desktop-only preferences: where saved files go.
const prefsFile=()=>path.join(app.getPath('userData'),'desktop.json');
function readPrefs(){try{const p=JSON.parse(fs.readFileSync(prefsFile(),'utf8'));return p&&typeof p==='object'?p:{};}catch{return {};}}
function writePrefs(p){fs.mkdirSync(path.dirname(prefsFile()),{recursive:true});fs.writeFileSync(prefsFile(),JSON.stringify(p,null,1));}
const existingDir=v=>typeof v==='string'&&v&&fs.existsSync(v)?v:'';
function saveState(){const p=readPrefs();const folder=existingDir(p.saveFolder);return {mode:p.saveMode==='folder'&&folder?'folder':'ask',folder,lastSaveDir:existingDir(p.lastSaveDir),version:app.getVersion()};}
// Open dialogs remember their own last folder (lastOpenDir), separate from saves (lastSaveDir).
const EXT={'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/webp':['webp']};
async function pickFiles(o){
 const exts=[...new Set(String(o.accept||'').split(',').map(s=>s.trim().toLowerCase()).flatMap(a=>EXT[a]||(/^\.[a-z0-9]+$/.test(a)?[a.slice(1)]:[])))];
 const p=readPrefs();
 const r=await dialog.showOpenDialog(mainWindow,{title:String(o.title||'파일 열기').slice(0,80),defaultPath:existingDir(p.lastOpenDir)||app.getPath('pictures'),properties:o.multiple?['openFile','multiSelections']:['openFile'],filters:exts.length?[{name:'지원 파일',extensions:exts},{name:'모든 파일',extensions:['*']}]:[]});
 if(r.canceled||!r.filePaths.length)return [];
 p.lastOpenDir=path.dirname(r.filePaths[0]);writePrefs(p);
 const out=[];
 for(const f of r.filePaths.slice(0,64)){const st=fs.statSync(f);if(!st.isFile()||st.size>100*1024*1024)throw Error(path.basename(f)+': 100MB 이하 파일만 열 수 있습니다.');out.push({name:path.basename(f),data:fs.readFileSync(f)});}
 return out;
}
const reserved=new Set();
function uniquePath(folder,name){
 const safe=path.basename(name||'image.png').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')||'image.png';
 const ext=path.extname(safe),stem=safe.slice(0,safe.length-ext.length);
 for(let i=0;i<10000;i++){const p=path.join(folder,i?`${stem} (${i})${ext}`:safe);if(!reserved.has(p)&&!fs.existsSync(p)){reserved.add(p);return p;}}
 throw Error('저장할 이름을 정하지 못했습니다.');
}
function fromEditor(event){return !!mainWindow&&event.sender===mainWindow.webContents;}
function registerIpc(){
 ipcMain.handle('refit:save-state',event=>fromEditor(event)?saveState():null);
 ipcMain.handle('refit:save-mode',(event,mode)=>{if(!fromEditor(event))return null;const p=readPrefs();p.saveMode=mode==='folder'?'folder':'ask';writePrefs(p);return saveState();});
 ipcMain.handle('refit:pick-folder',async event=>{
  if(!fromEditor(event))return null;
  const r=await dialog.showOpenDialog(mainWindow,{title:'결과를 저장할 폴더',properties:['openDirectory','createDirectory'],defaultPath:saveState().folder||saveState().lastSaveDir||app.getPath('pictures')});
  if(!r.canceled&&r.filePaths[0]){const p=readPrefs();p.saveFolder=r.filePaths[0];p.saveMode='folder';writePrefs(p);}
  return saveState();
 });
 ipcMain.handle('refit:pick-files',(event,o)=>fromEditor(event)?pickFiles(o&&typeof o==='object'?o:{}):[]);
 ipcMain.handle('refit:open-folder',event=>{if(!fromEditor(event))return;const s=saveState();if(s.folder)return shell.openPath(s.folder);});
 ipcMain.handle('refit:open-release',event=>{if(fromEditor(event))return shell.openExternal(RELEASES+'/latest');});
}
// Tell the editor when a newer GitHub release exists. Failures are silent.
function newer(a,b){const x=String(a).replace(/^v/,'').split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0);}return false;}
async function checkForUpdate(){
 try{
  const res=await net.fetch('https://api.github.com/repos/gadleChat/refit-canvas/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'Refit-Canvas'}});
  if(!res.ok)return;const d=await res.json();
  if(typeof d.tag_name==='string'&&/^v?\d+\.\d+\.\d+$/.test(d.tag_name)&&newer(d.tag_name,app.getVersion()))mainWindow?.webContents.send('refit:update',{version:d.tag_name.replace(/^v/,''),current:app.getVersion()});
 }catch{}
}

function startBackend(){
 const root=app.isPackaged?path.join(process.resourcesPath,'backend'):path.resolve(__dirname,'..');
 const python=process.platform==='win32'?path.join(root,'runtime','python.exe'):'python3';
 return new Promise((resolve,reject)=>{
  backend=spawn(python,['-u',path.join(root,'server.py'),'--desktop','--no-browser'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  let ready=false,stderr='';
  const timeout=setTimeout(()=>reject(Error('편집 엔진을 시작하지 못했습니다. 압축을 모두 풀었는지 확인하세요.')),20000);
  backend.stderr.on('data',data=>{stderr=(stderr+data).slice(-3000);});
  backend.on('error',error=>{clearTimeout(timeout);reject(Error('내부 실행 파일을 열 수 없습니다: '+error.message));});
  const lines=readline.createInterface({input:backend.stdout});
  lines.on('line',line=>{
   let data;try{data=JSON.parse(line);}catch{return;}
   if(data.event!=='ready'||ready||!/^http:\/\/127\.0\.0\.1:\d+$/.test(data.url))return;
   ready=true;clearTimeout(timeout);resolve(data.url);
  });
  backend.on('exit',code=>{
   clearTimeout(timeout);
   if(!ready)return reject(Error('편집 엔진이 종료되었습니다 ('+code+'). '+stderr));
   if(!stopping){dialog.showErrorBox('편집 엔진 종료','내부 엔진이 종료되었습니다. 프로그램을 다시 실행하세요.');app.quit();}
  });
 });
}
function stopBackend(){
 if(stopping)return;stopping=true;
 if(backend&&backend.exitCode===null){
  backend.stdin.end();
  const timer=setTimeout(()=>{if(backend.exitCode===null)backend.kill();},2000);timer.unref();
 }
}
function createWindow(){
 const display=require('electron').screen.getPrimaryDisplay().workAreaSize;
 mainWindow=new BrowserWindow({title:'Refit Canvas 1.6.1',width:Math.min(1600,display.width),height:Math.min(1000,display.height),minWidth:1080,minHeight:680,show:false,backgroundColor:'#f7f6fb',icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false,preload:path.join(__dirname,'preload.cjs')}});
 mainWindow.setMenuBarVisibility(false);
 mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!==origin&&url!==origin+'/')event.preventDefault();});
 let allowClose=false,checkingClose=false;
 mainWindow.on('close',event=>{
  if(allowClose)return;event.preventDefault();if(checkingClose)return;checkingClose=true;
  mainWindow.webContents.executeJavaScript("typeof S!=='undefined'&&(S.layers.length>0||S.busy)").then(async dirty=>{
   const choice=dirty?await dialog.showMessageBox(mainWindow,{type:'question',title:'편집 종료',message:'편집 중인 화면을 닫을까요?',detail:'필요한 작업은 프로젝트 저장으로 보관하세요. 생성 중인 요청은 서버에서 계속 처리될 수 있습니다.',buttons:['계속 편집','종료'],defaultId:0,cancelId:0,noLink:true}):{response:1};
   checkingClose=false;if(choice.response===1){allowClose=true;mainWindow.close();}
  }).catch(()=>{allowClose=true;checkingClose=false;mainWindow.close();});
 });
 mainWindow.once('ready-to-show',()=>mainWindow.show());
 mainWindow.webContents.once('did-finish-load',()=>{setTimeout(checkForUpdate,3000);});
 mainWindow.loadURL(origin);
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'파일',submenu:[{label:'프로젝트 저장',accelerator:'CmdOrCtrl+S',click:()=>mainWindow?.webContents.executeJavaScript("document.getElementById('saveProject').click()")},{type:'separator'},{role:'quit',label:'종료'}]},
  {label:'편집',submenu:[{role:'undo',label:'실행 취소'},{role:'redo',label:'다시 실행'},{type:'separator'},{role:'cut',label:'잘라내기'},{role:'copy',label:'복사'},{role:'paste',label:'붙여넣기'},{role:'selectAll',label:'전체 선택'}]},
  {label:'보기',submenu:[{role:'togglefullscreen',label:'전체 화면'},{label:'개발자 도구',accelerator:'CmdOrCtrl+Shift+I',click:()=>mainWindow?.webContents.toggleDevTools()}]},
  {label:'도움말',submenu:[{label:'앱 정보',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'Refit Canvas',message:'Refit Canvas 1.6.1',detail:'SDStudio 코드를 사용하는 비공식 독립 앱\n8픽셀 마스크 격자 정렬 · 메인/참조 배치 · 인페인트 · 메인 crop · 업스케일'})}]}
 ]));
}
if(process.platform==='win32'&&!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
 app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.on('will-download',(_event,item)=>{
   // Saves go straight into the chosen folder, or through a native Save dialog.
   const s=saveState();let target='';
   if(s.mode==='folder'){try{target=uniquePath(s.folder,item.getFilename());item.setSavePath(target);}catch{target='';}}
   if(!target)item.setSaveDialogOptions({title:'파일 저장',defaultPath:path.join(s.lastSaveDir||s.folder||app.getPath('downloads'),path.basename(item.getFilename()||'image.png'))});
   item.once('done',(_e,state)=>{if(target)reserved.delete(target);else if(state==='completed'){try{const p=readPrefs();p.lastSaveDir=path.dirname(item.getSavePath());writePrefs(p);}catch{}}mainWindow?.webContents.send('refit:saved',{ok:state==='completed',path:item.getSavePath(),folderMode:!!target});});
  });
  registerIpc();
  try{origin=await startBackend();createWindow();}catch(error){stopBackend();dialog.showErrorBox('Refit Canvas 실행 실패',error.message);app.quit();}
 });
 app.on('window-all-closed',()=>{stopBackend();app.quit();});
 app.on('will-quit',stopBackend);
 process.on('exit',()=>{if(backend&&backend.exitCode===null)backend.kill();});
}
