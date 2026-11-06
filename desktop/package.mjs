import {packager} from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..'),stage=path.join(root,'.package-stage'),backend=path.join(stage,'backend');
const version=JSON.parse(fs.readFileSync(path.join(here,'package.json'),'utf8')).version;
fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(backend,{recursive:true});
for(const name of ['server.py','api.py','runtime','static'])fs.cpSync(path.join(root,name),path.join(backend,name),{recursive:true,filter:p=>!p.includes('__pycache__')});
const result=await packager({dir:here,name:'Refit Canvas',executableName:'Refit-Canvas',appVersion:version,appCopyright:'Copyright (c) 2026 gadleChat · MIT',appBundleId:'local.refitcanvas',platform:'win32',arch:'x64',electronVersion:'45.2.0',out:path.join(root,'dist'),overwrite:true,asar:true,prune:true,icon:path.join(here,'icon.ico'),extraResource:[backend],ignore:[/^\/node_modules/,/^\/package\.mjs$/,/^\/package-lock\.json$/,/^\/RELEASE-README\.txt$/],win32metadata:{CompanyName:'Refit Canvas',FileDescription:'Refit Canvas',ProductName:'Refit Canvas',InternalName:'Refit-Canvas',OriginalFilename:'Refit-Canvas.exe'}});
// License notices and user readme that must ship next to the executable.
const out=result[0];
fs.copyFileSync(path.join(root,'LICENSE'),path.join(out,'LICENSE-REFIT-CANVAS.txt'));
fs.copyFileSync(path.join(root,'LICENSE-SDSTUDIO.txt'),path.join(out,'LICENSE-SDSTUDIO.txt'));
fs.cpSync(path.join(root,'third-party'),path.join(out,'third-party-licenses'),{recursive:true});
fs.writeFileSync(path.join(out,'README.txt'),fs.readFileSync(path.join(here,'RELEASE-README.txt'),'utf8').replace(/\r?\n/g,'\r\n'));
let commit='';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{}
fs.writeFileSync(path.join(out,'BUILD-INFO.json'),JSON.stringify({app:'Refit Canvas',formerly:'SDStudio Inpaint Desk',version,platform:'win32-x64',electron:'45.2.0',maskGrid:8,sourceRepository:'https://github.com/gadleChat/refit-canvas',sourceCommit:commit,sdstudioCommit:'45728589b9ffcb50dde5b8491c237afa2aae30fb',naiLiveTested:false,windowsRuntimeTested:false},null,2));
console.log(JSON.stringify({output:result}));
fs.rmSync(stage,{recursive:true,force:true});
