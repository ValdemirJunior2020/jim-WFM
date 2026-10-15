/* Jim WFM Local Data Manager — automatic private browser filesystem, with optional Windows-folder mirror.
   Files remain on Jim's device. A website cannot silently create a directory in Windows Downloads. */
(() => {
'use strict';
const DB='jimwfm-local-handle-v1',HANDLE_KEY='chosen-directory';
const AUTO_KEY='jimwfm-local-autosave-v2',STORAGE_KEY='jimwfm-local-activity-v1',LAST_SAVE_KEY='jimwfm-local-last-saved-v1';
const DIRS=['Uploads','Historical-Data','Dashboard-Settings','Backups','Exports','Logs'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const safeName=s=>String(s||'file').replace(/[/\\:*?"<>|\x00-\x1f]/g,'_').slice(0,150)||'file';
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
let ready=false,backend='initializing',internal=null,external=null,linked=false,remembered=false;
let enabled=localStorage.getItem(AUTO_KEY)!=='false',lastSaved=localStorage.getItem(LAST_SAVE_KEY)||null;
let status='Preparing automatic local storage…',pending=Promise.resolve(),booted=false,uploads=0,debounce=null,filesView=null,warning='';
const notice=(message,kind='info')=>{status=message;window.dispatchEvent(new CustomEvent('jim-local-status',{detail:{text:message,kind}}))};
const canPick=()=>typeof window.showDirectoryPicker==='function';
function dbOpen(){
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(Error('Browser IndexedDB not available'));
  const rq=indexedDB.open(DB,2);
  rq.onupgradeneeded=()=>{const d=rq.result;if(!d.objectStoreNames.contains('handles'))d.createObjectStore('handles');if(!d.objectStoreNames.contains('files'))d.createObjectStore('files')};
  rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error||Error('Storage access blocked'));
 });
}
async function dbAction(table,mode,op){
 const db=await dbOpen();
 try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(table,mode),req=op(tx.objectStore(table));
   if(req){req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}
   else {tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)}
 })}finally{db.close()}
}
const rememberFolder=async h=>{try{await dbAction('handles','readwrite',st=>st.put(h,HANDLE_KEY));remembered=true;return true}catch(e){remembered=false;console.warn('Folder selection could not be remembered',e);return false}};
const retrieveFolder=async()=>{try{return await dbAction('handles','readonly',st=>st.get(HANDLE_KEY))}catch{return null}};
const hasPermission=async h=>{try{return !!h&&(await h.queryPermission({mode:'readwrite'}))==='granted'}catch{return false}};
async function initializeStorage(){
 try{
  if(navigator.storage?.getDirectory){
   const top=await navigator.storage.getDirectory();
   internal=await top.getDirectoryHandle('Jim-WFM-Data',{create:true});
   for(const folder of DIRS)await internal.getDirectoryHandle(folder,{create:true});
   backend='private-filesystem';ready=true;return;
  }
 }catch(e){warning='Browser filesystem unavailable: '+String(e.message||e)}
 try{
  await dbOpen().then(db=>db.close());
  backend='indexeddb';ready=true;
 }catch(e){
  backend='unavailable';ready=false;warning='Browser storage is disabled or full. Allow site data or use the Download Backup button.';
 }
}
function readState(){
 let demo=null,service=null;
 try{demo=JSON.parse(localStorage.getItem('jimwfm-demo-v1')||'null')}catch{}
 try{service=JSON.parse(localStorage.getItem('jimwfm-service-history-v1')||'null')}catch{}
 return {version:1,app:'Jim WFM AI',savedAt:new Date().toISOString(),demo,service};
}
function activities(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return []}}
function record(event){
 const x=activities();x.push({at:new Date().toISOString(),action:String(event).slice(0,180)});
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(x.slice(-80)))}catch{}
}
async function writeInternal(folder,name,contents){
 if(!ready)throw Error('Local data storage is not ready');
 const fileName=safeName(name);
 if(backend==='private-filesystem'){
   const dir=await internal.getDirectoryHandle(folder,{create:true});
   const handle=await dir.getFileHandle(fileName,{create:true});
   const w=await handle.createWritable();
   try{await w.write(contents);await w.close()}catch(e){try{await w.abort()}catch{}throw e}
 }else{
   const blob=contents instanceof Blob?contents:new Blob([contents]);
   await dbAction('files','readwrite',st=>st.put(blob,folder+'/'+fileName));
 }
}
async function mirror(folder,name,contents){
 if(!linked||!external)return;
 try{
  if(!await hasPermission(external))throw Error('permission expired');
  const dir=await external.getDirectoryHandle(folder,{create:true});
  const handle=await dir.getFileHandle(safeName(name),{create:true});
  const writer=await handle.createWritable();
  try{await writer.write(contents);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}
 }catch(e){
  linked=false;warning='Windows folder needs reconnection. Automatic browser saving continues.';
  console.warn('Windows folder mirror paused:',e);
 }
}
async function write(folder,name,contents){
 // Browser-managed copy is authoritative: no prompt, always available on supported browsers.
 await writeInternal(folder,name,contents);
 await mirror(folder,name,contents);
}
async function readInternal(folder,name){
 if(backend==='private-filesystem'){
   const d=await internal.getDirectoryHandle(folder);
   const h=await d.getFileHandle(safeName(name));
   return h.getFile();
 }
 return await dbAction('files','readonly',st=>st.get(folder+'/'+safeName(name)));
}
async function saveInternal(action='Automatic save'){
 if(!ready)throw Error(warning||'Local storage is unavailable');
 const snap=readState();
 await write('Backups','jim-wfm-latest.json',JSON.stringify(snap,null,2));
 if(snap.demo)await write('Dashboard-Settings','dashboard-state.json',JSON.stringify(snap.demo,null,2));
 if(snap.service)await write('Historical-Data','service-history.json',JSON.stringify(snap.service,null,2));
 await write('Logs','recent-actions.json',JSON.stringify(activities(),null,2));
 const manifest={version:1,savedAt:snap.savedAt,lastAction:action,storage:backend,windowsFolder:linked?external?.name:null,subfolders:DIRS,privateData:true};
 await write('Logs','manifest.json',JSON.stringify(manifest,null,2));
 lastSaved=snap.savedAt;
 try{localStorage.setItem(LAST_SAVE_KEY,lastSaved)}catch{}
 notice(linked?'Saved automatically in browser and Windows folder':'Saved automatically in private browser storage','success');
 return true;
}
function enqueue(job){
 const task=pending.catch(()=>{}).then(job);
 pending=task.catch(e=>{warning=String(e.message||e);notice('Automatic save failed: '+warning,'error');console.warn('Jim WFM save failed',e)});
 return task;
}
function changed(action='Dashboard updated'){
 record(action);
 if(!enabled)return;
 clearTimeout(debounce);
 debounce=setTimeout(()=>{if(ready)enqueue(()=>saveInternal(action)).catch(()=>{})},450);
}
async function saveNow(){
 clearTimeout(debounce);
 if(!ready)await init();
 if(!ready){notice(warning||'Browser storage unavailable','error');return false}
 try{return await enqueue(()=>saveInternal('Save Everything Now'))}catch{return false}
}
async function chooseFolder(){
 // A remembered handle can refer to a Windows-protected directory. Never try to silently
 // reopen that stale handle or await its permission check before invoking the picker.
 // Call the picker immediately from Jim's click so the browser keeps user activation.
 if(!canPick()){
  notice('Windows folder selection needs Chrome or Edge. Automatic browser saving remains active; use Download Everything (.zip) for a Windows copy.','warning');
  return false;
 }
 try{
  const picking=window.showDirectoryPicker({mode:'readwrite',id:'jim-wfm-mirror',startIn:'documents'});
  const chosen=await picking;
  if(!chosen)return false;
  if(!await hasPermission(chosen)){
   // Do not call a second, delayed requestPermission: it may fail without activation.
   throw Error('Windows did not grant write permission. Select a normal folder inside Documents, not the Downloads root or another protected folder.');
  }
  return await connectExternal(chosen);
 }catch(e){
  if(e?.name==='AbortError'){
   notice('No Windows folder selected. Automatic browser saving continues normally.','info');
   return false;
  }
  const details=String(e?.message||e||'Folder access blocked');
  warning='Windows folder not connected: '+details+'. Try a normal folder within Documents. Jim WFM is still saving automatically in browser storage.';
  notice(warning,'warning');
  return false;
 }
}
async function copyExistingToWindows(){
 if(!ready||!linked||!external)return 0;
 let copied=0;
 for(const folder of DIRS){
  let files=[];
  if(backend==='private-filesystem'){
   const dir=await internal.getDirectoryHandle(folder,{create:true});
   for await(const [name,h] of dir.entries())if(h.kind==='file')files.push({name,body:await h.getFile()});
  }else{
   const keys=await dbAction('files','readonly',st=>st.getAllKeys());
   for(const key of keys.filter(k=>k.startsWith(folder+'/')))
    files.push({name:key.slice(folder.length+1),body:await dbAction('files','readonly',st=>st.get(key))});
  }
  for(const f of files){
   if(!linked)throw Error('Write permission was interrupted');
   if(copied>=500)throw Error('Copy limit reached; use Download Everything (.zip) for the rest');
   const dest=await external.getDirectoryHandle(folder,{create:true});
   const handle=await dest.getFileHandle(safeName(f.name),{create:true});
   const writer=await handle.createWritable();
   try{await writer.write(f.body);await writer.close()}catch(e){try{await writer.abort()}catch{}throw e}
   copied++;
  }
 }
 return copied;
}
async function connectExternal(chosen){
 // Keep the current folder until the replacement is fully authorized and validated.
 for(const name of DIRS)await chosen.getDirectoryHandle(name,{create:true});
 const previous=external,previousLinked=linked,previousRemembered=remembered;
 external=chosen;linked=true;
 try{
  const copies=await copyExistingToWindows();
  const saved=await saveNow();
  if(!saved||!linked)throw Error('Could not save to the selected Windows folder');
  const canRemember=await rememberFolder(chosen);
  record('Windows folder selected: '+chosen.name+'; copied '+copies+' existing files');
  warning='';
  notice('Windows folder connected: '+chosen.name+'. Copied '+copies+' existing saved files.'+(canRemember?'':' Browser may ask to select it on a future visit.'),'success');
  return true;
 }catch(e){
  external=previous;linked=previousLinked;remembered=previousRemembered;
  warning='The selected Windows folder could not be used: '+String(e?.message||e)+'. Automatic browser saving is still active.';
  notice(warning,'warning');
  return false;
 }
}
async function archiveFiles(files){
 if(!files?.length)return;
 if(!ready)await init();
 if(!ready){notice('Cannot preserve original Excel files: '+warning,'error');return}
 const originals=Array.from(files).filter(f=>f&&f.size<=25*1024*1024);
 if(!originals.length)return;
 return enqueue(async()=>{
  const prefix=stamp();
  for(const f of originals){
   await write('Uploads',prefix+'_'+safeName(f.name),f);
   uploads++;
  }
  record(originals.length+' uploaded file(s) archived');
  if(enabled)await saveInternal('Imported and selected uploaded workbooks');
 }).catch(()=>{});
}
function archiveExport(filename,body,mime){
 if(!enabled)return;
 let blob=body instanceof Blob?body:new Blob([body],{type:mime||'application/octet-stream'});
 enqueue(async()=>{
  if(!ready)await init();
  if(!ready)throw Error('Browser storage unavailable');
  await write('Exports',stamp()+'_'+safeName(filename),blob);
  record('Report exported: '+filename);
  await saveInternal('Report exported');
 }).catch(()=>{});
}
function restoreJSON(content){
 try{
  const backup=JSON.parse(content);
  if(backup.version!==1||(!backup.demo&&!backup.service))throw Error('Not a Jim WFM backup');
  if(backup.demo&&(!Array.isArray(backup.demo.agents)||!Array.isArray(backup.demo.shifts)||!backup.demo.settings))throw Error('Dashboard snapshot is invalid');
  if(backup.service&&(!backup.service.centers||!backup.service.calls))throw Error('Service snapshot is invalid');
  if(!window.confirm('Restore this local backup? The current dashboard and imported service history in this browser will be replaced.'))return false;
  if(backup.demo)localStorage.setItem('jimwfm-demo-v1',JSON.stringify(backup.demo));
  if(backup.service)localStorage.setItem('jimwfm-service-history-v1',JSON.stringify(backup.service));
  record('Restored historical state from backup');
  if(ready)awaitSafeSave();
  window.location.reload();
  return true;
 }catch(e){notice('Restore could not complete: '+(e.message||e),'error');return false}
}
function awaitSafeSave(){enqueue(()=>saveInternal('Restored backup')).catch(()=>{})}
async function restoreLatest(){
 if(!ready)await init();
 try{const file=await readInternal('Backups','jim-wfm-latest.json');if(!file)throw Error('No backup found');
  return restoreJSON(await file.text());
 }catch(e){notice('Restore failed: '+(e.message||e),'warning');return false}
}
function downloadBlob(name,blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=safeName(name);document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}

/* Portable ZIP export with all locally saved files (no network, no dependencies). */
function crc32(bytes){
 let c=0xffffffff;
 for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}
 return (c^0xffffffff)>>>0;
}
function zipHeader(signature,size){
 const u=new Uint8Array(size),v=new DataView(u.buffer);
 v.setUint32(0,signature,true);return {u,v};
}
async function downloadAll(){
 if(!ready)await init();
 if(!ready){notice('Local storage unavailable; nothing can be exported','error');return false}
 notice('Preparing a complete local ZIP backup…','info');
 try{
  const textEncoder=new TextEncoder(),chunks=[],central=[];
  let offset=0,count=0,centralSize=0,totalBytes=0;
  for(const folder of DIRS){
   const names=[];
   if(backend==='private-filesystem'){
    const directory=await internal.getDirectoryHandle(folder,{create:true});
    for await(const [filename,handle] of directory.entries())if(handle.kind==='file')names.push({name:filename,file:await handle.getFile()});
   }else{
    const keys=await dbAction('files','readonly',st=>st.getAllKeys());
    for(const path of keys.filter(k=>k.startsWith(folder+'/'))){
      const name=path.slice(folder.length+1);
      names.push({name,file:await dbAction('files','readonly',st=>st.get(path))});
    }
   }
   for(const {name,file} of names){
    if(!file)continue;
    const blob=file instanceof Blob?file:new Blob([file]);
    totalBytes+=blob.size;
    if(totalBytes>120*1024*1024||count>=500)throw Error('Backup is too large for one ZIP. Download individual files using View Saved Files.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const path=textEncoder.encode('Jim-WFM-Data/'+folder+'/'+name);
    const crc=crc32(bytes),len=bytes.byteLength;
    const {u:lh,v:lv}=zipHeader(0x04034b50,30);
    lv.setUint16(4,20,true);lv.setUint16(8,0,true);lv.setUint32(14,crc,true);lv.setUint32(18,len,true);lv.setUint32(22,len,true);lv.setUint16(26,path.length,true);
    chunks.push(lh,path,bytes);
    const {u:ch,v:cv}=zipHeader(0x02014b50,46);
    cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);
    cv.setUint32(20,len,true);cv.setUint32(24,len,true);cv.setUint16(28,path.length,true);cv.setUint32(42,offset,true);
    central.push(ch,path);centralSize+=46+path.length;
    offset+=30+path.length+len;count++;
   }
  }
  const {u:end,v:ev}=zipHeader(0x06054b50,22);
  ev.setUint16(8,count,true);ev.setUint16(10,count,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
  const zip=new Blob([...chunks,...central,end],{type:'application/zip'});
  downloadBlob('Jim-WFM-Everything-'+stamp()+'.zip',zip);
  notice('Complete ZIP download started: '+count+' saved files, including imported Excel originals.','success');
  record('Downloaded all '+count+' files as ZIP');
  return true;
 }catch(e){notice('ZIP export failed: '+String(e.message||e),'error');return false}
}

function exportBackup(){
 downloadBlob('Jim-WFM-Backup-'+stamp()+'.json',new Blob([JSON.stringify(readState(),null,2)],{type:'application/json'}));
 record('Downloaded dashboard and history backup to computer');
 notice('Backup download started. This copy is visible in your computer Downloads.','success');
}
async function listSaved(){
 if(!ready)await init();
 if(!ready)return;
 const items=[];
 try{
  if(backend==='private-filesystem'){
   for(const directory of DIRS){
    const d=await internal.getDirectoryHandle(directory,{create:true});
    for await(const [name,handle] of d.entries())if(handle.kind==='file')items.push(directory+'/'+name);
   }
  }else{
   const keys=await dbAction('files','readonly',st=>st.getAllKeys());
   items.push(...keys);
  }
  filesView=items.sort((a,b)=>a.localeCompare(b)).slice(0,120);
  notice(filesView.length+' saved files found in Jim WFM','success');
 }catch(e){notice('Could not list files: '+(e.message||e),'warning')}
}
async function downloadSaved(path){
 const parts=String(path).split('/');
 if(parts.length!==2||!DIRS.includes(parts[0])||parts[1]!==safeName(parts[1]))return;
 try{
  const file=await readInternal(parts[0],parts[1]);
  if(!file)throw Error('File not found');
  downloadBlob(parts[1],file instanceof Blob?file:new Blob([file]));
  notice('Downloaded '+parts[1]+' to the computer','success');
 }catch(e){notice('Could not download file: '+(e.message||e),'warning')}
}
function toggleAuto(){
 enabled=!enabled;
 try{localStorage.setItem(AUTO_KEY,String(enabled))}catch{}
 record('Auto Save '+(enabled?'ON':'OFF'));
 if(enabled)saveNow();
 else notice('Auto Save paused. Existing saved files are preserved.','warning');
}
function statusInfo(){
 return {ready,backend,enabled,linked,folder:external?.name||null,remembered,lastSaved,status,warning,uploads,canPick:canPick()};
}
function render(){
 const s=statusInfo(),auto=s.ready&&s.enabled;
 const rows=filesView?.map(path=>'<div class="local-saved-row"><span>'+esc(path)+'</span><button type="button" class="btn" data-action="local-download-file" data-path="'+esc(path)+'">Download</button></div>').join('');
 return '<div class="headrow"><div><div class="eyebrow">TOOLS & SETTINGS / PRIVATE COMPUTER STORAGE</div><h1>Jim’s Local Data Manager</h1><p>Your data is saved automatically in this browser — no Windows Downloads folder permission required.</p></div></div>'+
 '<section class="panel local-manager-card"><div class="local-manager-top"><div class="local-manager-head"><div class="local-manager-icon">✦</div><div><div class="panel-title">Automatic Local Save Center</div><div class="panel-sub">'+(s.ready?'Jim-WFM-Data / '+DIRS.length+' folders created automatically': 'Preparing secure local storage…')+'</div></div></div><span class="local-manager-badge '+(auto?'linked':'')+'">'+(auto?'AUTO SAVE ON':s.ready?'AUTO SAVE PAUSED':'STORAGE NOT READY')+'</span></div>'+
 '<p class="local-manager-state" aria-live="polite">'+esc(s.status)+(s.lastSaved?' · Last saved '+new Date(s.lastSaved).toLocaleString():'')+'</p>'+
 '<p class="local-manager-permanence">'+(s.ready?'Jim WFM automatically creates and saves its own local data without choosing a Windows system folder. This is private browser storage, not a visible folder under Downloads.':'Your browser must allow this website to keep site data.')+'</p>'+
 '<div class="local-manager-actions"><button class="btn primary" data-action="local-save">Save Everything Now</button><button class="btn" data-action="local-list">View Saved Files</button><button class="btn" data-action="local-download-all">Download Everything (.zip)</button><button class="btn" data-action="local-download">Download Dashboard Backup (.json)</button><button class="btn" data-action="local-restore">Restore Latest Backup</button><button class="btn" data-action="local-upload-backup">Import Backup File</button><button class="btn" data-action="local-toggle-auto">'+(s.enabled?'Turn Auto Save Off':'Turn Auto Save On')+'</button></div>'+
 '<input type="file" id="local-backup-input" accept=".json" hidden/>'+
 '<div class="local-manager-folders">'+DIRS.map(n=>'<span>'+esc(n)+'</span>').join('')+'</div>'+
 (filesView?'<div class="local-saved-files"><strong>Saved on this browser ('+filesView.length+')</strong>'+ (rows||'<p>No saved files yet.</p>')+'</div>':'')+
 '<div class="local-manager-external"><div><strong>Optional Windows folder copy</strong><p>To see your saved files directly in File Explorer, select a regular folder within Documents. Jim WFM copies existing saved files into it. Chrome cannot select the protected Downloads folder itself.</p><p>'+(s.linked?'Windows copy connected: <strong>'+esc(s.folder)+'</strong>':s.folder?'Your previously selected Windows folder is not authorized. Use Choose Windows Folder to select a permitted location.':'No Windows folder linked. Automatic browser saving and Download Everything (.zip) work without one.')+'</p></div><div class="local-manager-actions"><button class="btn" data-action="local-choose">'+(s.linked?'Change Windows Folder':'Choose Windows Folder (optional)')+'</button></div></div>'+
 '<div class="notice local-manager-notice">Private browser files survive normal browser restarts in this browser profile, but deleting site data, using Incognito, or storage eviction can remove them. Download a backup periodically. Uploaded source spreadsheets may contain employee information; keep downloads in an approved private folder.</div>'+
 '</section><section class="panel section-gap"><div class="panel-title">Automatically saved items</div><p>All selected uploaded Excel files, 30-day and historical aggregates, dashboard edits, local configuration, shift and target changes, private backups, exports, and logs. Browser-only demo data is separate from real Tableau history.</p></section>';
}
async function init(){
 if(booted)return;
 booted=true;
 await initializeStorage();
 const savedFolder=await retrieveFolder();
 if(savedFolder){
  external=savedFolder;remembered=true;linked=await hasPermission(external);
  if(!linked)warning='The Windows folder is remembered but may need permission again. Browser saving is not affected.';
 }
 if(ready){
  notice(backend==='private-filesystem'?'Automatic browser folders ready — no folder selection needed':'Automatic private storage ready — no folder selection needed','success');
  if(enabled)enqueue(()=>saveInternal('Startup autosave')).catch(()=>{});
 }else notice(warning||'Local storage unavailable','error');
}
window.JimLocalData={init,render,chooseFolder,saveNow,changed,archiveFiles,archiveExport,restoreLatest,restoreJSON,exportBackup,toggleAuto,statusInfo,notice,listSaved,downloadSaved,downloadAll};
window.addEventListener('DOMContentLoaded',()=>{init().catch(e=>notice('Storage setup failed: '+String(e.message||e),'error'))});
})();