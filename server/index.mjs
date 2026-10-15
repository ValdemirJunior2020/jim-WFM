/**
 * Jim WFM AI — opt-in local Ollama bridge, Node 22+, zero npm dependencies.
 * Exposes no employee data, no arbitrary filesystem access, and no shell execution.
 * Code changes are a two-person-pattern workflow: local model draft + human approval.
 * Never expose port 8787 directly to the public internet.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile, appendFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { handleRoster, serveRosterUi } from './roster.mjs';

const current=dirname(fileURLToPath(import.meta.url));
const root=resolve(current,'..');
const envPath=resolve(current,'.env.local');
try {
  const envText=await readFile(envPath,'utf8');
  for(const line of envText.split(/\r?\n/)){
    const match=line.match(/^([A-Z_]+)=(.*)$/);
    if(match&&!process.env[match[1]]) process.env[match[1]]=match[2].trim();
  }
}catch{}
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const TOKEN=process.env.ADMIN_TOKEN||'';
const MODEL=process.env.OLLAMA_MODEL||'qwen2.5-coder:7b';
const OLLAMA_BASE=process.env.OLLAMA_BASE||'http://127.0.0.1:11434';
const ORIGINS=(process.env.CORS_ORIGINS||'http://localhost:4173,http://127.0.0.1:4173,http://localhost:8888,http://localhost:5500,https://jim-wfm-ai.netlify.app,https://wfm.hotelplannerqa.com').split(',').map(x=>x.trim()).filter(Boolean);
const ALLOWED_FILES=new Set(['index.html','styles.css','app.js']);
const drafts=new Map();
if(TOKEN.length<24){console.error('ADMIN_TOKEN must be at least 24 characters. Run START-LOCAL-AI.bat to generate it.');process.exit(1)}
if(!Number.isInteger(PORT)||PORT<1||PORT>65535){console.error('Invalid PORT');process.exit(1)}

function respond(res,status,body,origin){const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};if(ORIGINS.includes(origin)){headers['access-control-allow-origin']=origin;headers['access-control-allow-headers']='Authorization, Content-Type';headers['access-control-allow-methods']='GET,POST,OPTIONS'}res.writeHead(status,headers);res.end(JSON.stringify(body))}
const error=(res,status,message,origin)=>respond(res,status,{error:message},origin);
function allowedFilePath(file){if(!ALLOWED_FILES.has(file))throw Error('This file is not approved for AI editing');return resolve(root,file)}
async function jsonBody(req){let content='';for await(const chunk of req){content+=chunk.toString();if(content.length>1024*1024)throw Error('Request too large')}try{return JSON.parse(content)}catch{throw Error('Expected JSON body')}}
async function audit(event){await appendFile(resolve(current,'audit-log.jsonl'),JSON.stringify({...event,at:new Date().toISOString()})+'\n','utf8')}
async function ollama(messages){const ac=new AbortController();const timeout=setTimeout(()=>ac.abort(),110000);try{const r=await fetch(new URL('/api/chat',OLLAMA_BASE),{method:'POST',signal:ac.signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:MODEL,messages,stream:false,format:'json',options:{temperature:0.1,num_ctx:8192}})});if(!r.ok)throw Error(`Ollama HTTP ${r.status}`);const obj=await r.json();if(!obj.message?.content)throw Error('Ollama returned no content');return obj.message.content}finally{clearTimeout(timeout)}}
async function health(){try{const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),2500);const r=await fetch(new URL('/api/tags',OLLAMA_BASE),{signal:ac.signal});clearTimeout(tm);if(!r.ok)throw Error('Unavailable');const data=await r.json();const installed=data.models?.some(x=>x.name===MODEL||x.name?.startsWith(MODEL.split(':')[0]+':'));return {bridge:'online',ollama:'online',model:MODEL,modelInstalled:!!installed}}catch{return {bridge:'online',ollama:'offline',model:MODEL,modelInstalled:false}}}
const parseModel=(s)=>{const clean=s.replace(/^```(?:json)?\s*|\s*```$/gi,'').trim();const obj=JSON.parse(clean);if(typeof obj!=='object'||obj===null||Array.isArray(obj))throw Error('Invalid model proposal');return obj};
async function makeDraft(prompt,file){const path=allowedFilePath(file);const source=await readFile(path,'utf8');if(source.length>95000)throw Error('File is too large for model-guided edits');const instructions=`You are helping Jim propose a narrowly scoped change in a local static workforce dashboard.\nReply with ONE JSON object only: {"summary":"...","file":"${file}","find":"exact substring that already exists in the file","replace":"replacement for that exact substring","risk":"low|medium|high"}. Find must be an EXACT existing contiguous substring, 10 to 4000 chars, unique in the provided file. Replacement max 12000 chars. No scripts, command execution, API credentials, or external APIs. If change cannot be expressed as one exact text replacement, respond {"summary":"Cannot safely draft","error":"explanation"}. Never remove security notices, demo labels or review gates.\nRequested change: ${prompt}\nCurrent contents of ${file}:\n${source.slice(0,74000)}`;
const result=parseModel(await ollama([{role:'system',content:'You are a careful engineering assistant. Output strictly valid JSON.'},{role:'user',content:instructions}]));if(result.error)throw Error(String(result.error).slice(0,350));if(result.file!==file||typeof result.find!=='string'||typeof result.replace!=='string'||result.find.length<10||result.find.length>4000||result.replace.length>12000)throw Error('Model proposal failed validation');if(source.split(result.find).length!==2)throw Error('Model text must match exactly once');if(/ADMIN_TOKEN|BEGIN PRIVATE KEY|\.env\.local/i.test(result.replace))throw Error('Potential secret in proposed change');const id=randomUUID();const next=source.replace(result.find,result.replace);drafts.set(id,{id,file,summary:String(result.summary||'Local AI change').slice(0,300),find:result.find,replace:result.replace,source,next,created:Date.now()});await audit({action:'draft',id,file,summary:result.summary});return {id,file,summary:result.summary||'Proposed edit',risk:result.risk||'review',find:result.find,replace:result.replace,warning:'Human approval required. This does not deploy automatically.'}}
async function applyDraft(id){const draft=drafts.get(id);if(!draft||Date.now()-draft.created>3600000)throw Error('Draft expired or missing');const path=allowedFilePath(draft.file);const before=await readFile(path,'utf8');if(before!==draft.source)throw Error('File changed since proposal was created; draft again');const backupDir=resolve(current,'backups');await mkdir(backupDir,{recursive:true});const safeName=draft.file.replace(/[^a-z0-9.-]/gi,'_');const backup=join(backupDir,`${Date.now()}-${id}-${safeName}`);await copyFile(path,backup);try{await writeFile(path,draft.next,'utf8');if(draft.file.endsWith('.js')){const test=spawnSync(process.execPath,['--check',path],{timeout:8000,encoding:'utf8'});if(test.status!==0)throw Error(`JavaScript syntax check failed: ${test.stderr.slice(0,350)}`)}drafts.delete(id);await audit({action:'apply',id,file:draft.file,summary:draft.summary,backup});return {applied:true,file:draft.file,summary:draft.summary,backupAvailable:true,warning:'Only the LOCAL working tree changed. Review git diff, then commit and push to deploy.'}}catch(e){await copyFile(backup,path);throw e}}

createServer(async(req,res)=>{const origin=req.headers.origin||'';if(req.method==='OPTIONS'){if(!ORIGINS.includes(origin))return error(res,403,'Origin not allowed',origin);return respond(res,200,{ok:true},origin)}
 if(origin&&!ORIGINS.includes(origin))return error(res,403,'Origin not allowed',origin);
 if(req.method==='GET'&&req.url==='/api/health')return respond(res,200,await health(),origin);
 if(req.method==='GET'&&req.url==='/roster')return serveRosterUi(res);
 if(req.headers.authorization!==`Bearer ${TOKEN}`)return error(res,401,'Admin token required',origin);
 if(req.method==='GET'&&req.url==='/api/auth-check')return respond(res,200,await health(),origin);
 try{if(req.url?.startsWith('/api/roster'))return await handleRoster(req,res,origin);
 if(req.method==='POST'&&req.url==='/api/changes/draft'){const b=await jsonBody(req);const prompt=String(b.prompt||'').trim(),file=String(b.file||'');if(prompt.length<6||prompt.length>3000)throw Error('Prompt must be 6–3000 characters');return respond(res,200,await makeDraft(prompt,file),origin)}
 if(req.method==='POST'&&req.url==='/api/changes/apply'){const b=await jsonBody(req);if(b.confirm!=='APPROVE')throw Error('Explicit approval required');return respond(res,200,await applyDraft(String(b.id||'')),origin)}
 return error(res,404,'Not found',origin)}catch(e){await audit({action:'error',message:String(e.message).slice(0,500)}).catch(()=>{});return error(res,400,String(e.message).slice(0,500),origin)}
}).listen(PORT,HOST,()=>console.log(`Jim WFM local AI bridge ready at http://${HOST}:${PORT}; allowed origins: ${ORIGINS.length}. Never expose directly.`));
