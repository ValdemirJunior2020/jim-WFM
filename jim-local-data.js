/* Jim WFM local data manager — offline, browser-side only. No credentials/roster vault data. */
(() => {
'use strict';
const DB='jimwfm-local-handle-v1',HANDLE_KEY='chosen-directory',AUTO_KEY='jimwfm-local-autosave-v1',STORAGE_KEY='jimwfm-local-activity-v1';
const DIRS=['Uploads','Historical-Data','Dashboard-Settings','Backups','Exports','Logs'];
let root=null,linked=false,lastSaved=null,status='Folder not linked',pending=Promise.resolve(),uploadCounts=0,booted=false,remembered=false;
let enabled=localStorage.getItem(AUTO_KEY)!=='false',waiting=false;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
function notice(text,kind='info'){status=text;window.dispatchEvent(new CustomEvent('jim-local-status',{detail:{text,kind}}))}
function canPick(){return typeof window.showDirectoryPicker==='function'}
const safeName=s=>String(s||'file').replace(/[/\\:*?"<>|\x00-\x1f]/g,'_').slice(0,130)||'file';
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window))return reject(Error('IndexedDB unavailable'));
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>req.result.createObjectStore('handles');
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>resolve(req.result);
 });
}
async function storeHandle(h){
 try{
  const db=await openDB();
  await new Promise((resolve,reject)=>{const t=db.transaction('handles','readwrite');t.objectStore('handles').put(h,HANDLE_KEY);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
  db.close();remembered=true;return true;
 }catch(e){remembered=false;console.warn('Cannot remember folder selection across browser restarts:',e);return false}
}
async function loadHandle(){
 try{const db=await openDB();const h=await new Promise((resolve,reject)=>{const req=db.transaction('handles','readonly').objectStore('handles').get(HANDLE_KEY);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return h||null}catch{return null}
}
async function granted(h){if(!h)return false;try{return (await h.queryPermission({mode:'readwrite'}))==='granted'}catch{return false}}
function snapshot(){
 let demo=null,service=null;
 try{demo=JSON.parse(localStorage.getItem('jimwfm-demo-v1')||'null')}catch{}
 try{service=JSON.parse(localStorage.getItem('jimwfm-service-history-v1')||'null')}catch{}
 return {version:1,app:'Jim WFM AI',savedAt:new Date().toISOString(),demo,service};
}
function activity(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return []}}
function record(action){const items=activity();items.push({at:new Date().toISOString(),action:String(action).slice(0,200)});try{localStorage.setItem(STORAGE_KEY,JSON.stringify(items.slice(-75)))}catch{}}
async function write(subfolder,name,contents){
 if(!root||!linked)throw Error('Choose Jim’s folder first');
 const dir=await root.getDirectoryHandle(subfolder,{create:true});
 const file=await dir.getFileHandle(safeName(name),{create:true});
 const stream=await file.createWritable();
 try{await stream.write(contents);await stream.close()}catch(e){try{await stream.abort()}catch{}throw e}
}
async function doSave(action='Manual save'){
 if(!root||!linked)throw Error('Choose Jim’s folder to enable computer saves');
 if(!await granted(root)){linked=false;notice('Folder permission needed. Reconnect the folder.','warning');throw Error('Folder write permission expired')}
 const snap=snapshot(),text=JSON.stringify(snap,null,2);
 await write('Backups','jim-wfm-latest.json',text);
 if(snap.demo)await write('Dashboard-Settings','dashboard-state.json',JSON.stringify(snap.demo,null,2));
 if(snap.service)await write('Historical-Data','service-history.json',JSON.stringify(snap.service,null,2));
 const log=activity();
 await write('Logs','recent-actions.json',JSON.stringify(log,null,2));
 const manifest={version:1,savedAt:snap.savedAt,lastAction:action,folder:root.name,files:['Backups/jim-wfm-latest.json','Dashboard-Settings/dashboard-state.json','Historical-Data/service-history.json','Logs/recent-actions.json'],note:'Browser snapshots only. Private roster/password vaults and admin secrets are excluded.'};
 await write('Logs','manifest.json',JSON.stringify(manifest,null,2));
 lastSaved=snap.savedAt;
 notice('Saved on Jim’s computer','success');
 return manifest;
}
function enqueue(task){
 const job=pending.catch(()=>{}).then(task);
 pending=job.catch(e=>{notice('Save failed: '+(e.message||e),'error');console.warn('Jim WFM local save failed',e)});
 return job;
}
let debounce=null;
function changed(reason='Dashboard updated'){
 record(reason);
 if(!enabled||!linked)return;
 clearTimeout(debounce);
 debounce=setTimeout(()=>{enqueue(()=>doSave(reason)).catch(()=>{})},550);
}
async function saveNow(){
 if(!root||!linked){notice('Choose your computer folder first','warning');return false}
 clearTimeout(debounce);
 try{await enqueue(()=>doSave('Save Everything Now'));return true}catch{return false}
}
async function prepareFolder(h){
 root=h;
 // Create the user-authorized subfolders without altering any existing content.
 for(const name of DIRS)await h.getDirectoryHandle(name,{create:true});
 linked=true;
 const stored=await storeHandle(h);
 record('Local folder linked: '+h.name);
 notice(stored?'Saved folder: '+h.name+' — Auto Save ready':'Connected for this visit, but the browser could not remember the folder. Allow site storage for persistence.',stored?'success':'warning');
 return saveNow();
}
function pickerError(error){
 const name=String(error?.name||''),message=String(error?.message||error||'Unknown error');
 if(name==='AbortError')return; // User dismissed the chooser.
 let explanation='Could not open the folder chooser: '+message;
 if(name==='SecurityError'||name==='NotAllowedError'||name==='InvalidStateError')
  explanation='The browser blocked folder access. Open https://hp-wfm.netlify.app directly in Chrome or Edge (not inside a preview/iframe), then click Choose My Folder again. Browser or company policy may restrict file access.';
 notice(explanation,'error');
 // Make blocked permissions obvious rather than looking like an inert button.
 if(typeof window.alert==='function')window.alert(explanation);
}
async function chooseFolder(forceNew=false){
 try{
  // Reuse the folder handle stored in IndexedDB from previous visits. Do NOT open a second picker.
  if(!forceNew&&root){
   if(linked&&await granted(root))return saveNow();
   if(typeof root.requestPermission==='function'){
    // Prompt from the direct user click: Chromium requires a user gesture for this request.
    const permission=await root.requestPermission({mode:'readwrite'});
    if(permission==='granted')return prepareFolder(root);
    throw Object.assign(new Error('Write access was not granted for '+root.name),{name:'NotAllowedError'});
   }
  }
  if(!canPick()){
   const message='Folder picking is unavailable in this browser. Open https://hp-wfm.netlify.app directly in the latest Chrome or Edge on Windows, then click Choose My Folder. The folder stays selected in this browser profile.';
   notice(message,'warning');
   if(typeof window.alert==='function')window.alert(message);
   return false;
  }
  // IMPORTANT: call the native picker immediately inside the click handler.
  // Do not await IndexedDB, permissions, or other work before the picker opens.
  const pickerPromise=window.showDirectoryPicker({id:'jim-wfm-data',mode:'readwrite',startIn:'documents'});
  const h=await pickerPromise;
  if(!h)return false;
  // User selecting a folder with mode=readwrite grants write permission in supported Chromium.
  if(!await granted(h)){
   const result=await h.requestPermission?.({mode:'readwrite'});
   if(result!=='granted')throw Object.assign(new Error('Write permission was not granted'),{name:'NotAllowedError'});
  }
  return await prepareFolder(h);
 }catch(e){pickerError(e);return false}
}
async function archiveFiles(files){
 if(!root||!linked||!files?.length)return;
 const f=Array.from(files).filter(x=>x&&x.size<=25*1024*1024);
 if(!f.length)return;
 return enqueue(async()=>{
   if(!await granted(root))throw Error('Folder permission expired');
   const prefix=stamp();
   for(const file of f){
    await write('Uploads',prefix+'_'+safeName(file.name),file);
    uploadCounts++;
   }
   record('Archived '+f.length+' successfully imported file(s)');
   await doSave('Service files imported');
 }).catch(()=>{});
}
function archiveExport(filename,body,mime){
 if(!enabled||!linked)return;
 let blob=body instanceof Blob?body:new Blob([body],{type:mime||'application/octet-stream'});
 enqueue(async()=>{await write('Exports',stamp()+'_'+safeName(filename),blob);record('Export saved: '+filename);await doSave('Export saved: '+filename)}).catch(()=>{});
}
async function restoreLatest(){
 if(!root||!linked){notice('Link your folder to restore its backup','warning');return false}
 try{
  const dir=await root.getDirectoryHandle('Backups');
  const h=await dir.getFileHandle('jim-wfm-latest.json');
  const f=await h.getFile();return restoreJSON(await f.text());
 }catch(e){notice('Cannot restore: '+(e.message||e),'error');return false}
}
function restoreJSON(body){
 try{
  const json=JSON.parse(body);
  if(json.version!==1||(!json.demo&&!json.service))throw Error('Invalid Jim WFM backup');
  if(json.demo&&(!Array.isArray(json.demo.agents)||!Array.isArray(json.demo.shifts)||!json.demo.settings))throw Error('Invalid dashboard data');
  if(json.service&&(!json.service.centers||!json.service.calls))throw Error('Invalid service data');
  if(!window.confirm('Restore this backup? This replaces this browser’s current dashboard and service data. Consider Save Everything Now first.'))return false;
  if(json.demo)localStorage.setItem('jimwfm-demo-v1',JSON.stringify(json.demo));
  if(json.service)localStorage.setItem('jimwfm-service-history-v1',JSON.stringify(json.service));
  record('Restored backup to browser');
  if(linked)enqueue(()=>doSave('Restored backup')).catch(()=>{});
  window.location.reload();return true;
 }catch(e){notice('Restore failed: '+(e.message||e),'error');return false}
}
function exportBackup(){
 const file=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'});
 const url=URL.createObjectURL(file),a=document.createElement('a');
 a.href=url;a.download='jim-wfm-complete-backup.json';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 archiveExport('jim-wfm-complete-backup.json',file,'application/json');
}
function toggleAuto(){
 enabled=!enabled;localStorage.setItem(AUTO_KEY,String(enabled));
 record('Automatic saving '+(enabled?'enabled':'disabled'));
 if(enabled&&linked)saveNow();
 notice(enabled?'Auto Save enabled':'Auto Save turned off','info');
}
function statusInfo(){
 return {linked,enabled,folder:root?.name||null,remembered,lastSaved,status,canPick:canPick(),uploads:uploadCounts};
}
function render(){
 const s=statusInfo(),isSaving=s.linked&&s.enabled;
 return '<div class="headrow"><div><div class="eyebrow">TOOLS & SETTINGS / PRIVATE COMPUTER STORAGE</div><h1>Jim’s Local Data Manager</h1><p>Store Tableau reports, dashboard changes, backups and exports in a folder Jim chooses on his own computer.</p></div></div>'+
 '<section class="panel local-manager-card"><div class="local-manager-top"><span class="local-manager-glow" aria-hidden="true"></span><div class="local-manager-head"><div class="local-manager-icon">✦</div><div><div class="panel-title">My Computer Save Center</div><div class="panel-sub">'+(s.linked?'Folder linked: '+esc(s.folder):'No computer folder selected yet')+'</div></div></div><span class="local-manager-badge '+(isSaving?'linked':'')+'">'+(isSaving?'AUTO SAVE ON':s.linked?'AUTO SAVE OFF':'FOLDER NOT LINKED')+'</span></div>'+
 '<p class="local-manager-state" aria-live="polite">'+esc(s.status)+(s.lastSaved?' · Last saved '+new Date(s.lastSaved).toLocaleString():'')+'</p>'+'<p class="local-manager-permanence">'+(s.folder?'Remembered folder: <strong>'+esc(s.folder)+'</strong>. '+(s.linked?'Files will be saved here while access is granted.':'Click <strong>Reconnect Saved Folder</strong> to reauthorize this same location without selecting it again.'):'Choose a folder on your computer once. This browser remembers it for later visits; it may ask to authorize access again.')+'</p>'+
 '<div class="local-manager-actions"><button class="btn primary" data-action="local-choose">'+(s.linked?'Save to Selected Folder':s.folder?'Reconnect Saved Folder':'Choose My Folder')+'</button><button class="btn" data-action="local-change-folder">Change Folder</button><button class="btn" data-action="local-save" '+(!s.linked?'disabled':'')+'>Save Everything Now</button><button class="btn" data-action="local-restore" '+(!s.linked?'disabled':'')+'>Restore Latest Backup</button><button class="btn" data-action="local-download">Download Backup</button><button class="btn" data-action="local-upload-backup">Import Backup File</button><button class="btn" data-action="local-toggle-auto">'+(s.enabled?'Turn Auto Save Off':'Turn Auto Save On')+'</button></div>'+
 '<input type="file" id="local-backup-input" accept=".json" hidden/>'+
 '<div class="local-manager-folders">'+DIRS.map(n=>'<span>'+esc(n)+'</span>').join('')+'</div>'+
 '<div class="notice local-manager-notice">Browser folder access requires a supported Chrome or Edge browser over HTTPS. You must grant write permission; the browser may ask again. Until linked, Jim WFM keeps using its existing browser storage. If file saving fails, the status changes to a warning. This page cannot save the private password vault or files from other applications.</div>'+
 '</section><section class="panel section-gap"><div class="panel-title">What gets saved?</div><p>Imported Excel originals after successful import, historical service aggregates, demo agent edits, settings, shifts, targets, browser backups, CSV exports, and a recent-actions log. Changes save automatically when Auto Save is on and the folder remains authorized.</p><p class="footnote">Keep this folder private: uploaded Tableau workbooks may contain employee information. File permissions are controlled by Windows and the user, not by Jim WFM.</p></section>';
}
async function init(){
 if(booted)return;booted=true;
 const found=await loadHandle();
 if(!found)return;
 root=found;remembered=true;
 if(await granted(found)){linked=true;notice('Saved folder '+found.name+' ready for Auto Save','success')}
 else notice('Saved folder '+found.name+' remembered. Click Reconnect Saved Folder once if the browser asks for permission.','warning');
}
window.JimLocalData={init,render,chooseFolder,saveNow,changed,archiveFiles,archiveExport,restoreLatest,restoreJSON,exportBackup,toggleAuto,statusInfo,notice};
window.addEventListener('DOMContentLoaded',()=>{init().catch(()=>{})});
})();