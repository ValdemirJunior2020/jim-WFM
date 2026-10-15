/** Private roster CRUD for Jim WFM, hosted only by the authenticated local AI bridge.
 * Never put employee imports or credentials in the GitHub repository or Netlify build.
 */
import {readFile,writeFile,rename,mkdir,copyFile,appendFile} from 'node:fs/promises';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv,randomUUID,createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {vaultSummary,vaultSet,vaultRead,vaultDelete,vaultPrune,vaultConfigured} from './password-vault.mjs';
const home=dirname(fileURLToPath(import.meta.url));
const privateDir=resolve(home,'private');
const storage=join(privateDir,'roster.enc');
const fields=['id','center','name','email','role','supervisor','status','wave','startDate','productionDate','hpId','site','source','archived'];
const centers=new Set(['Buwelo','Concentrix','WNS','Telus']);
const forbidden=/password|passwd|credential|secret|token|^pw$|^login.?pw$/i;
function clean(source){
 if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Record must be an object');
 if(Object.keys(source).some(x=>forbidden.test(x)))throw Error('Import contains credential fields. Remove password columns before importing.');
 const out={};for(const key of fields){if(key==='archived')continue;const raw=source[key];out[key]=raw==null?'':String(raw).trim().slice(0,key==='email'?180:160)}
 if(!centers.has(out.center))throw Error('Invalid center');
 if(!out.name||out.name.length<2||!/^\S+@\S+\.\S+$/.test(out.email))throw Error('Name and email are required');
 if(!out.id||!/^[a-zA-Z0-9._-]{1,60}$/.test(out.id))out.id=createHash('sha256').update(out.center+'|'+out.email.toLowerCase()).digest('hex').slice(0,24);
 if(!['Active','On Leave','Inactive','Terminated'].includes(out.status))out.status='Active';
 out.archived=source.archived===true;
 return out;
}
function key(salt){const token=process.env.ADMIN_TOKEN||'';if(token.length<24)throw Error('Invalid local administrator token');return scryptSync(token,salt,32)}
function encrypt(data){const salt=randomBytes(16),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(salt),iv);const enc=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return JSON.stringify({v:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:enc.toString('base64')})}
function decrypt(text){const obj=JSON.parse(text);if(obj.v!==1)throw Error('Unrecognized store version');const decipher=createDecipheriv('aes-256-gcm',key(Buffer.from(obj.salt,'base64')),Buffer.from(obj.iv,'base64'));decipher.setAuthTag(Buffer.from(obj.tag,'base64'));const p=Buffer.concat([decipher.update(Buffer.from(obj.data,'base64')),decipher.final()]);return JSON.parse(p.toString('utf8'))}
async function load(){try{const text=await readFile(storage,'utf8');const data=decrypt(text);if(!Array.isArray(data))throw Error('Invalid stored roster');return data}catch(e){if(e.code==='ENOENT')return [];throw Error('Could not open encrypted roster: '+e.message)}}
async function save(records){await mkdir(privateDir,{recursive:true,mode:0o700});try{await copyFile(storage,join(privateDir,'roster-backup-'+Date.now()+'-'+randomUUID()+'.enc'))}catch(e){if(e.code!=='ENOENT')throw e}
const tmp=join(privateDir,'roster-'+randomUUID()+'.tmp');await writeFile(tmp,encrypt(records),{mode:0o600,flag:'wx'});await rename(tmp,storage)}
async function log(action,details={}){await mkdir(privateDir,{recursive:true,mode:0o700});await appendFile(join(privateDir,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),action,...details})+'\n',{mode:0o600})}
function result(res,origin,status,body){const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};const origins=(process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim());if(origins.includes(origin)){h['access-control-allow-origin']=origin;h['access-control-allow-headers']='Authorization,Content-Type'}res.writeHead(status,h);res.end(JSON.stringify(body))}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>2000000)throw Error('Upload too large');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Valid JSON required')}}
export async function handleRoster(req,res,origin){const url=new URL(req.url,'http://localhost');const action=url.pathname;try{
 if(req.method==='GET'&&action==='/api/roster'){const records=await load(),passwordIds=await vaultSummary();return result(res,origin,200,{records:records.map(({password,...row})=>({...row,hasPassword:passwordIds.has(row.id)})),vaultConfigured:vaultConfigured(),updatedAt:new Date().toISOString(),mode:'PRIVATE_ROSTER_NOT_LIVE_STATUS'})}
 if(req.method==='GET'&&action==='/api/roster/audit'){let text='';try{text=await readFile(join(privateDir,'audit.jsonl'),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}return result(res,origin,200,{events:text.trim().split('\n').filter(Boolean).slice(-200).map(x=>JSON.parse(x))})}
 if(req.method!=='POST')return result(res,origin,405,{error:'Method not allowed'});
 const input=await body(req),records=await load();
 if(['/api/roster/password/set','/api/roster/password/reveal','/api/roster/password/delete'].includes(action)){
  if(!records.some(x=>x.id===input.id))throw Error('Agent does not exist');
  if(action.endsWith('/set')){if(input.confirm!=='SET_PASSWORD')throw Error('SET_PASSWORD confirmation required');await vaultSet(input.id,input.password,input.vaultKey);await log('password_set',{id:input.id});return result(res,origin,200,{ok:true});}
  if(action.endsWith('/reveal')){if(input.confirm!=='REVEAL_PASSWORD')throw Error('REVEAL_PASSWORD confirmation required');const password=await vaultRead(input.id,input.vaultKey);await log('password_revealed',{id:input.id});return result(res,origin,200,{password});}
  if(input.confirm!=='DELETE_PASSWORD')throw Error('DELETE_PASSWORD confirmation required');await vaultDelete(input.id,input.vaultKey);await log('password_deleted',{id:input.id});return result(res,origin,200,{ok:true});
 }

 if(action==='/api/roster/import'){
   if(input.confirm!=='IMPORT'||!Array.isArray(input.records)||input.records.length>20000)throw Error('Confirm IMPORT and supply up to 20,000 sanitized records');
   if(input.mode==='replace'&&input.replaceConfirm!=='REPLACE_ROSTER')throw Error('Separate REPLACE_ROSTER approval required');
   const cleaned=input.records.map(clean),originalCount=records.length;
   const byKey=new Map((input.mode==='replace'?[]:records).map(x=>[x.center+'|'+x.email.toLowerCase(),x]));
   for(const row of cleaned)byKey.set(row.center+'|'+row.email.toLowerCase(),row);
   const next=[...byKey.values()];await save(next);if(input.mode==='replace')await vaultPrune(next.map(x=>x.id));await log('import',{submitted:cleaned.length,before:originalCount,after:next.length,mode:input.mode==='replace'?'replace':'merge'});
   return result(res,origin,200,{ok:true,submitted:cleaned.length,before:originalCount,after:next.length});
 }
 if(action==='/api/roster/save'){
   if(input.confirm!=='SAVE')throw Error('Explicit SAVE approval required');const row=clean(input.record),i=records.findIndex(x=>x.id===row.id);
   const idCollision=records.some((x,j)=>j!==i&&x.center===row.center&&x.email.toLowerCase()===row.email.toLowerCase());if(idCollision)throw Error('An agent with this center and email already exists');
   if(i<0)records.push(row);else records[i]=row;await save(records);await log('save',{id:row.id,mode:i<0?'create':'edit'});return result(res,origin,200,{ok:true,id:row.id});
 }
 if(action==='/api/roster/archive'||action==='/api/roster/restore'||action==='/api/roster/delete'){
   if(typeof input.id!=='string')throw Error('Record ID required');const i=records.findIndex(x=>x.id===input.id);if(i<0)throw Error('Record not found');
   const needed=action.endsWith('/archive')?'ARCHIVE':action.endsWith('/restore')?'RESTORE':'PERMANENTLY_DELETE';if(input.confirm!==needed)throw Error('Confirmation '+needed+' required');
   if(needed==='PERMANENTLY_DELETE')records.splice(i,1);else records[i].archived=needed==='ARCHIVE';await save(records);if(needed==='PERMANENTLY_DELETE')await vaultPrune(records.map(x=>x.id));await log(needed.toLowerCase(),{id:input.id});return result(res,origin,200,{ok:true});
 }
 return result(res,origin,404,{error:'No such endpoint'});
}catch(e){return result(res,origin,400,{error:String(e.message).slice(0,250)})}}
export async function serveRosterUi(res){const data=await readFile(join(home,'roster-admin.html'),'utf8');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline';script-src 'unsafe-inline';connect-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'"});res.end(data)}
