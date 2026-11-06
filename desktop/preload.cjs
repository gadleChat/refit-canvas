'use strict';
// Small, fixed bridge for the editor page. No Node APIs are exposed.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('refitDesktop',Object.freeze({
 getSaveState:()=>ipcRenderer.invoke('refit:save-state'),
 setSaveMode:mode=>ipcRenderer.invoke('refit:save-mode',mode),
 pickSaveFolder:()=>ipcRenderer.invoke('refit:pick-folder'),
 openSaveFolder:()=>ipcRenderer.invoke('refit:open-folder'),
 pickFiles:options=>ipcRenderer.invoke('refit:pick-files',options),
 openReleasePage:()=>ipcRenderer.invoke('refit:open-release'),
 onSaved:callback=>{ipcRenderer.on('refit:saved',(_event,info)=>callback(info));},
 onUpdate:callback=>{ipcRenderer.on('refit:update',(_event,info)=>callback(info));},
}));
