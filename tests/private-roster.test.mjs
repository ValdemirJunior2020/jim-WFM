import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('private roster encrypts data, supports CRUD, and rejects credential columns', async () => {
 const root=join(dirname(fileURLToPath(import.meta.url)),'..');
 const dir=await mkdtemp(join(tmpdir(),'jim-wfm-roster-'));
 await cp(join(root,'server','roster.mjs'),join(dir,'roster.mjs'));
 await cp(join(root,'server','password-vault.mjs'),join(dir,'password-vault.mjs'));
 await cp(join(root,'server','roster-admin.html'),join(dir,'roster-admin.html'));
 const old=process.env.ADMIN_TOKEN,oldVault=process.env.ROSTER_VAULT_KEY;process.env.ADMIN_TOKEN='testing-admin-token-32-characters-abcd';process.env.ROSTER_VAULT_KEY='testing-password-vault-key-32-characters';
 const {handleRoster}=await import(pathToFileURL(join(dir,'roster.mjs')).href);
 const server=createServer((req,res)=>handleRoster(req,res,''));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function query(path,body){
   const r=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
   return {status:r.status,body:await r.json()};
 }
 try {
  let result=await query('/api/roster');
  assert.equal(result.body.records.length,0);
  result=await query('/api/roster/import',{confirm:'IMPORT',records:[
   {id:'example-1',name:'Example Alice',email:'alice@example.com',center:'Buwelo',status:'Active'},
   {id:'example-2',name:'Example Bob',email:'bob@example.com',center:'Telus',status:'On Leave'}
  ]});
  assert.equal(result.status,200);assert.equal(result.body.after,2);
  const stored=await readFile(join(dir,'private','roster.enc'),'utf8');
  assert.equal(stored.includes('alice@example.com'),false);
  result=await query('/api/roster/archive',{id:'example-1',confirm:'ARCHIVE'});assert.equal(result.status,200);
  result=await query('/api/roster/restore',{id:'example-1',confirm:'RESTORE'});assert.equal(result.status,200);
  result=await query('/api/roster/delete',{id:'example-1',confirm:'PERMANENTLY_DELETE'});assert.equal(result.status,200);
  result=await query('/api/roster/import',{confirm:'IMPORT',records:[{name:'Bad Example',email:'bad@example.com',center:'Buwelo',password:'secret'}]});assert.equal(result.status,400);
  result=await query('/api/roster');assert.equal(result.body.records.length,1);
  assert.equal(result.body.records[0].name,'Example Bob');
  const id=result.body.records[0].id;
  result=await query('/api/roster/password/set',{confirm:'SET_PASSWORD',id,password:'temporary-example-123',vaultKey:process.env.ROSTER_VAULT_KEY});
  assert.equal(result.status,200);
  const vault=await readFile(join(dir,'private','password-vault.enc'),'utf8');
  assert.equal(vault.includes('temporary-example-123'),false);
  result=await query('/api/roster');assert.equal(result.body.records[0].hasPassword,true);
  assert.equal(JSON.stringify(result.body).includes('temporary-example-123'),false);
  result=await query('/api/roster/password/reveal',{confirm:'REVEAL_PASSWORD',id,vaultKey:'wrong-admin-vault-passphrase'});
  assert.equal(result.status,400);
  result=await query('/api/roster/password/reveal',{confirm:'REVEAL_PASSWORD',id,vaultKey:process.env.ROSTER_VAULT_KEY});
  assert.equal(result.status,200);assert.equal(result.body.password,'temporary-example-123');
  result=await query('/api/roster/password/delete',{confirm:'DELETE_PASSWORD',id,vaultKey:process.env.ROSTER_VAULT_KEY});
  assert.equal(result.status,200);
  result=await query('/api/roster');assert.equal(result.body.records[0].hasPassword,false);
 } finally {
  await new Promise(resolve=>server.close(resolve));
  if(old===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=old;
  if(oldVault===undefined)delete process.env.ROSTER_VAULT_KEY;else process.env.ROSTER_VAULT_KEY=oldVault;
  await rm(dir,{recursive:true,force:true});
 }
});
