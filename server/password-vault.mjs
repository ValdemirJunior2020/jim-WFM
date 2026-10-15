/** Separate encrypted credential vault for Jim only.
 * Never return passwords in general roster responses or logs.
 * Requires local ADMIN_TOKEN authentication from the parent API plus a second vault key for reads/writes.
 */
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = resolve(dirname(fileURLToPath(import.meta.url)), 'private');
const file = join(base, 'password-vault.enc');
const vaultSecret = () => process.env.ROSTER_VAULT_KEY || '';
function check(passphrase){
 const secret=vaultSecret();
 if(secret.length<24)throw Error('Password vault is disabled: generate ROSTER_VAULT_KEY locally');
 const expected=createHash('sha256').update(secret).digest();
 const actual=createHash('sha256').update(String(passphrase||'')).digest();
 if(!timingSafeEqual(actual,expected))throw Error('Vault authorization failed');
}
function enc(data){
 const salt=randomBytes(16),iv=randomBytes(12);
 const key=scryptSync(vaultSecret(),salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);
 const cipherText=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
 return JSON.stringify({v:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:cipherText.toString('base64')});
}
function dec(payload){
 const obj=JSON.parse(payload);if(obj.v!==1)throw Error('Unsupported vault format');
 const key=scryptSync(vaultSecret(),Buffer.from(obj.salt,'base64'),32);
 const d=createDecipheriv('aes-256-gcm',key,Buffer.from(obj.iv,'base64'));d.setAuthTag(Buffer.from(obj.tag,'base64'));
 const data=JSON.parse(Buffer.concat([d.update(Buffer.from(obj.data,'base64')),d.final()]).toString('utf8'));
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid vault');return data;
}
async function load(){try{return dec(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw Error('Unable to open encrypted password vault: '+e.message)}}
async function save(data){await mkdir(base,{recursive:true,mode:0o700});try{await copyFile(file,join(base,'passwords-backup-'+Date.now()+'-'+randomUUID()+'.enc'))}catch(e){if(e.code!=='ENOENT')throw e}
 const tmp=join(base,'passwords-'+randomUUID()+'.tmp');await writeFile(tmp,enc(data),{mode:0o600,flag:'wx'});await rename(tmp,file);
}
export async function vaultSummary(){const obj=await load();return new Set(Object.keys(obj).filter(k=>typeof obj[k]==='string'&&!!obj[k]))}
export async function vaultSet(id,value,key){check(key);if(typeof id!=='string'||!/^[a-z0-9._-]{1,60}$/i.test(id))throw Error('Invalid record ID');if(typeof value!=='string'||value.length<1||value.length>256)throw Error('Password must be 1–256 characters');const data=await load();data[id]=value;await save(data);return true}
export async function vaultRead(id,key){check(key);const data=await load();if(!Object.hasOwn(data,id))throw Error('No password saved for this agent');return data[id]}
export async function vaultDelete(id,key){check(key);const data=await load();if(!Object.hasOwn(data,id))return false;delete data[id];await save(data);return true}
export async function vaultPrune(ids){const data=await load();const wanted=new Set(ids);let count=0;for(const id of Object.keys(data))if(!wanted.has(id)){delete data[id];count++}if(count)await save(data);return count}
export function vaultConfigured(){return vaultSecret().length>=24}
