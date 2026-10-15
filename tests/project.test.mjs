import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>readFile(resolve(root,p),'utf8');
test('HTML includes accessible app root and local scripts',async()=>{
 const html=await read('index.html');assert.match(html,/<div id="app"><\/div>/);assert.match(html,/src="\/app\.js"/);assert.match(html,/href="\/styles\.css"/);
});
test('all required call centers are present in app demo',async()=>{
 const js=await read('app.js');for(const name of ['Buwelo','Concentrix','WNS','Telus'])assert.ok(js.includes(name));assert.match(js,/DEMO DATA/);assert.match(js,/Super Admin AI Studio/);
});
test('code remains parseable with Node syntax checker',()=>{
 for(const file of ['app.js','server/index.mjs']){const t=spawnSync(process.execPath,['--check',resolve(root,file)],{encoding:'utf8'});assert.equal(t.status,0,t.stderr)}
});
test('backend uses local host, admin-token length check, and allowlist',async()=>{
 const js=await read('server/index.mjs');assert.match(js,/127\.0\.0\.1/);assert.match(js,/TOKEN\.length<24/);assert.match(js,/ALLOWED_FILES/);assert.match(js,/APPROVE/);assert.doesNotMatch(js,/\beval\s*\(/);
});
