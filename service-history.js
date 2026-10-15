/* Jim WFM — offline XLSX importer; no uploads or third-party scripts. */
(() => {
'use strict';
const KEY='jimwfm-service-history-v1';
const CENTERS=['Buwelo','Concentrix','WNS','Telus'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const pct=(a,b)=>b>0?Math.round(100*a/b):0;
const empty=()=>({version:1,centers:{},calls:{},updatedAt:null,sourceFiles:[]});
let store;
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');store=s?.version===1&&s.centers&&s.calls?s:empty()}catch{store=empty()}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(store))}catch{throw Error('Browser storage is full or disabled. Download a backup first.')}};
const localISO=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const period=()=>{const end=new Date();end.setHours(12,0,0,0);const start=new Date(end);start.setDate(start.getDate()-29);return {start:localISO(start),end:localISO(end)}};
function parseDate(x){
  if(x==null||x==='')return null;
  const s=String(x).trim();let d;
  if(/^\d{4}-\d\d-\d\d$/.test(s))return s;
  if(/^\d\d?\/\d\d?\/\d{2,4}$/.test(s)){const p=s.split('/').map(Number);d=new Date(p[2]<100?2000+p[2]:p[2],p[0]-1,p[1],12)}
  else if(/^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(s))d=new Date(s.replace(',','')+' 12:00:00');
  else if(typeof x==='number'&&x>40000&&x<90000)d=new Date(Date.UTC(1899,11,30)+x*86400000);
  else return null;
  if(!d||!Number.isFinite(d.getTime()))return null;
  const iso=localISO(d);return iso.slice(0,4)>='2020'&&iso.slice(0,4)<='2100'?iso:null;
}
function xml(s){const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('Invalid Excel XML');return d}
const childText=(node,tag)=>{const e=node.getElementsByTagName(tag);return e.length?e[0].textContent:''};
async function workbookRows(file){
  if(file.size>25*1024*1024)throw Error(file.name+' exceeds the 25 MB limit');
  const data=await file.arrayBuffer(),v=new DataView(data),bytes=new Uint8Array(data);let end=-1;
  for(let p=data.byteLength-22;p>=Math.max(0,data.byteLength-65558);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break}
  if(end<0)throw Error('Invalid .xlsx file');
  const count=v.getUint16(end+10,true),offset=v.getUint32(end+16,true),files=new Map();let at=offset;
  if(count>1000||offset>=data.byteLength)throw Error('Invalid Excel ZIP directory');
  for(let i=0;i<count;i++){
    if(v.getUint32(at,true)!==0x02014b50)throw Error('Damaged Excel directory');
    const entry={method:v.getUint16(at+10,true),size:v.getUint32(at+20,true),expanded:v.getUint32(at+24,true),local:v.getUint32(at+42,true),flags:v.getUint16(at+8,true)};
    const n=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true);
    const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+n));
    if(!name.includes('..')&&(name==='xl/sharedStrings.xml'||/^xl\/worksheets\/sheet\d+\.xml$/.test(name)))files.set(name,entry);
    at+=46+n+extra+comment;if(at>data.byteLength)throw Error('Damaged Excel ZIP file');
  }
  async function read(name){
    const e=files.get(name);if(!e)throw Error('Missing '+name);
    if(e.flags&1||e.expanded>45*1024*1024)throw Error('Encrypted or oversized Excel worksheet');
    const p=e.local;if(v.getUint32(p,true)!==0x04034b50)throw Error('Invalid Excel ZIP entry');
    const start=p+30+v.getUint16(p+26,true)+v.getUint16(p+28,true);
    if(start+e.size>data.byteLength)throw Error('Corrupted Excel ZIP entry');
    const compressed=bytes.slice(start,start+e.size);let unpacked;
    if(e.method===0)unpacked=compressed;
    else if(e.method===8){
      if(typeof DecompressionStream==='undefined')throw Error('Use a current Chrome or Firefox browser');
      try{unpacked=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())}
      catch{throw Error('Cannot decompress XLSX; use the latest Chrome')}
    }else throw Error('Unsupported Excel ZIP compression');
    if(unpacked.length>45*1024*1024)throw Error('Excel worksheet is too large');
    return new TextDecoder().decode(unpacked);
  }
  const shared=[];
  if(files.has('xl/sharedStrings.xml')){
    const d=xml(await read('xl/sharedStrings.xml'));
    for(const si of Array.from(d.getElementsByTagName('si'))){
      shared.push(Array.from(si.getElementsByTagName('t')).map(t=>t.textContent).join(''));
      if(shared.length>100000)throw Error('Too many Excel strings');
    }
  }
  const worksheet=[...files.keys()].filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]))[0];
  if(!worksheet)throw Error('Missing Excel worksheet');
  const d=xml(await read(worksheet)),rows=[];let cellCount=0;
  for(const row of Array.from(d.getElementsByTagName('row'))){
    const cells=[];
    for(const c of Array.from(row.getElementsByTagName('c'))){
      const letters=(c.getAttribute('r')||'').match(/^[A-Z]+/i)?.[0]||'';let col=0;
      for(const char of letters.toUpperCase())col=col*26+char.charCodeAt(0)-64;
      col--;if(col<0||col>200)continue;
      const t=c.getAttribute('t'),raw=childText(c,'v');
      const value=t==='s'?shared[Number(raw)]||'':t==='inlineStr'?Array.from(c.getElementsByTagName('t')).map(x=>x.textContent).join(''):t==='b'?raw==='1':(raw!==''&&Number.isFinite(Number(raw))?Number(raw):raw);
      cells[col]=value;
      if(++cellCount>300000)throw Error('Too many Excel cells');
    }
    rows.push(cells);if(rows.length>20000)throw Error('Too many Excel rows');
  }
  return rows;
}
const centerFromName=n=>{const s=n.toLowerCase();return s.includes('buwelo')?'Buwelo':s.includes('concentrix')?'Concentrix':s.includes('wns')?'WNS':/(telus|\btus\b)/.test(s)?'Telus':null};
function parseUtilization(rows,filename){
  const center=centerFromName(filename);if(!center)throw Error('File name must contain Buwelo, Concentrix, WNS, or Telus: '+filename);
  const col=(rows[1]||[]).findIndex(x=>String(x).trim().toLowerCase()==='grand total');
  if(col<3)throw Error('Grand Total column not found: '+filename);
  const days={},identifiers={};let date=null,seen=0;
  for(const row of rows.slice(2)){
    if(row[0]!=null&&row[0]!=='')date=parseDate(row[0]);
    if(!date)continue;
    const status=String(row[2]||'').trim(),key=({Available:'available','On Call':'onCall',Break:'break',Offline:'offline'})[status];
    const minutes=Number(row[col]);if(!key||!Number.isFinite(minutes)||minutes<0||row[col]==null)continue;
    const item=days[date]||(days[date]={available:0,onCall:0,break:0,offline:0,agents:0});
    item[key]+=minutes;if(row[1]){const ids=identifiers[date]||(identifiers[date]=new Set());ids.add(String(row[1]))}seen++;
  }
  for(const d in days)days[d].agents=identifiers[d]?.size||0;
  if(!seen)throw Error('No usable service-time records: '+filename);
  return {type:'utilization',center,days};
}
function parseCalls(rows,filename){
  const heads=rows[1]||[];
  if(heads[0]!=='Day of Created-At'||heads[4]!=='Answered Calls'||heads[6]!=='Answered Calls')throw Error('Unsupported TELUS agent activity format: '+filename);
  const days={},ids={};let date=null,seen=0;
  for(const row of rows.slice(2)){
    if(row[0]!=null&&row[0]!=='')date=parseDate(row[0]);
    if(!date)continue;
    const service=Number(row[4])||0,outbound=Number(row[6])||0;
    if(service<0||outbound<0||!Number.isFinite(service+outbound)||!(service||outbound))continue;
    const d=days[date]||(days[date]={service:0,outbound:0,serviceTalk:0,outboundTalk:0,agents:0});
    d.service+=service;d.outbound+=outbound;
    d.serviceTalk+=service*Math.max(0,Number(row[5])||0);
    d.outboundTalk+=outbound*Math.max(0,Number(row[7])||0);
    if(row[3]){const set=ids[date]||(ids[date]=new Set());set.add(String(row[3]))}seen++;
  }
  for(const d in days)days[d].agents=ids[d]?.size||0;
  if(!seen)throw Error('No valid call records in '+filename);
  return {type:'calls',days};
}
function merge(next,parsed,filename){
  const target=parsed.type==='calls'?next.calls:(next.centers[parsed.center]||(next.centers[parsed.center]={}));
  const keys=parsed.type==='calls'?['service','outbound','serviceTalk','outboundTalk','agents']:['available','onCall','break','offline','agents'];
  let count=0;
  for(const [day,values] of Object.entries(parsed.days)){
    if(!/^\d{4}-\d\d-\d\d$/.test(day))continue;
    const row={};for(const key of keys){const x=Number(values[key]);row[key]=Number.isFinite(x)&&x>=0?Math.round(x*1000)/1000:0}
    target[day]=row;count++;
  }
  if(!count)throw Error('No dated rows in '+filename);
  next.updatedAt=new Date().toISOString();
  next.sourceFiles=[...new Set([...(next.sourceFiles||[]),filename])].slice(-40);
  return count;
}
async function importFiles(files){
  if(!files.length)throw Error('Choose one or more Excel files');
  if(files.length>12)throw Error('Upload up to 12 reports at a time');
  const next=structuredClone(store),report=[];
  for(const file of files){
    const filename=file.name.toLowerCase();
    if(filename.endsWith('.xlsx')){
      const rows=await workbookRows(file),isCalls=rows[1]?.[0]==='Day of Created-At';
      const parsed=isCalls?parseCalls(rows,file.name):parseUtilization(rows,file.name);
      report.push(file.name+': '+merge(next,parsed,file.name)+' dates imported');
    }else if(filename.endsWith('.json')){
      if(file.size>2*1024*1024)throw Error('Snapshot exceeds 2 MB');
      const snapshot=JSON.parse(await file.text());
      if(snapshot.version!==1||!snapshot.centers||!snapshot.calls)throw Error('Invalid private snapshot');
      for(const c of CENTERS)if(snapshot.centers[c])merge(next,{type:'utilization',center:c,days:snapshot.centers[c]},file.name);
      if(Object.keys(snapshot.calls).length)merge(next,{type:'calls',days:snapshot.calls},file.name);
      report.push(file.name+': private snapshot loaded');
    }else throw Error('Only .xlsx and private .json snapshots are supported');
  }
  store=next;persist();return report;
}
function recent(o){const p=period();return Object.fromEntries(Object.entries(o||{}).filter(([d])=>d>=p.start&&d<=p.end))}
function summary(filter){
  const rows={},centers=[],names=filter==='All Centers'?CENTERS:[filter];
  for(const c of names){
    const source=recent(store.centers[c]),item={center:c,days:Object.keys(source).length,available:0,onCall:0,break:0,offline:0,agentsMax:0};
    for(const [date,d] of Object.entries(source)){
      const r=rows[date]||(rows[date]={date,available:0,onCall:0,break:0,offline:0,service:0,outbound:0});
      for(const key of ['available','onCall','break','offline']){const n=Number(d[key]||0);item[key]+=n;r[key]+=n}
      item.agentsMax=Math.max(item.agentsMax,Number(d.agents||0));
    }
    centers.push(item);
  }
  const calls=filter==='All Centers'||filter==='Telus'?recent(store.calls):{};
  for(const [date,d] of Object.entries(calls)){
    const r=rows[date]||(rows[date]={date,available:0,onCall:0,break:0,offline:0,service:0,outbound:0});
    r.service+=Number(d.service||0);r.outbound+=Number(d.outbound||0);
  }
  const total=centers.reduce((r,c)=>{for(const key of ['available','onCall','break','offline'])r[key]+=c[key];return r},{available:0,onCall:0,break:0,offline:0});
  return {centers,total,service:Object.values(calls).reduce((s,c)=>s+Number(c.service||0),0),outbound:Object.values(calls).reduce((s,c)=>s+Number(c.outbound||0),0),days:Object.values(rows).sort((a,b)=>b.date.localeCompare(a.date))};
}
function render(center){
  const p=period(),s=summary(center),busy=s.total.onCall,ready=s.total.available,has=Object.keys(store.centers).length||Object.keys(store.calls).length;
  const byCenter=s.centers.map(c=>'<tr><td><strong>'+esc(c.center)+'</strong></td><td>'+c.days+'</td><td>'+fmt(c.onCall/60)+'</td><td>'+fmt(c.available/60)+'</td><td>'+pct(c.onCall,c.onCall+c.available)+'%</td><td>'+fmt(c.break/60)+'</td><td>'+fmt(c.agentsMax)+'</td></tr>').join('');
  const byDay=s.days.map(d=>'<tr><td>'+esc(d.date)+'</td><td>'+fmt(d.onCall/60)+'</td><td>'+fmt(d.available/60)+'</td><td>'+pct(d.onCall,d.onCall+d.available)+'%</td><td>'+fmt(d.service)+'</td><td>'+fmt(d.outbound)+'</td></tr>').join('');
  const files=(store.sourceFiles||[]).slice(-5).map(x=>'<span class="pill">'+esc(x)+'</span>').join(' ');
  return '<div class="headrow"><div><div class="eyebrow">HISTORICAL WORKFORCE / PRIVATE BROWSER DATA</div><h1>Upload Service sheets</h1><p>Recorded status time and calls, not live telephony availability.</p></div></div>'+
   '<section class="panel"><div class="panel-head"><div><div class="panel-title">Update Jim’s Service Data</div><div class="panel-sub">Rolling 30 calendar days: '+p.start+' to '+p.end+'</div></div><span class="pill">BROWSER ONLY</span></div>'+
   '<p class="section-gap">Choose Buwelo Service, Concentrix Service, WNS Service, Telus Utilization and TUS Service Agents Excel files. New imports <strong>replace overlapping days</strong> without double-counting.</p>'+
   '<div class="service-import-actions"><input type="file" id="service-files" accept=".xlsx,.json" multiple aria-label="Choose service Excel reports"><button class="btn primary" data-action="import-service">Import selected files</button><button class="btn" data-action="export-service">Export private JSON backup</button><button class="btn" data-action="export-service-csv">Export 30-day CSV</button><button class="btn danger" data-action="clear-service">Clear history</button></div>'+
   '<p class="footnote">Runs locally in this browser, with no data upload to Netlify, Ollama or a server. Only daily center totals are stored. Employee names and IDs are discarded. Data is NOT synchronized to other computers. Keep your private backup.</p>'+
   (files?'<div class="service-source-list">Imported: '+files+'</div>':'')+'</section>'+
   (!has?'<section class="panel section-gap"><div class="panel-title">No historical reports imported</div><p>Upload your five Excel files or your private Jim WFM snapshot to see the real last-30-day metrics. This does not change demo live statuses.</p></section>':
   '<div class="stats-grid service-stats">'+
   '<div class="stat-card"><div class="stat-top"><span>ON CALL HOURS</span></div><div class="stat-number">'+fmt(busy/60)+'</div><div class="stat-foot">Recorded service-state time</div></div>'+
   '<div class="stat-card"><div class="stat-top"><span>AVAILABLE HOURS</span></div><div class="stat-number">'+fmt(ready/60)+'</div><div class="stat-foot">Recorded available-state time</div></div>'+
   '<div class="stat-card"><div class="stat-top"><span>ON-CALL SHARE</span></div><div class="stat-number">'+pct(busy,busy+ready)+'%</div><div class="stat-foot">On Call / (On Call + Available)</div></div>'+
   '<div class="stat-card"><div class="stat-top"><span>TELUS CALLS</span></div><div class="stat-number">'+fmt(s.service+s.outbound)+'</div><div class="stat-foot">'+fmt(s.service)+' service · '+fmt(s.outbound)+' outbound</div></div></div>'+
   '<section class="panel section-gap"><div class="panel-head"><div><div class="panel-title">Center Activity Comparison</div><div class="panel-sub">Status minutes converted to hours · incomplete days are not filled with zeroes</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Center</th><th>Days</th><th>On call (h)</th><th>Available (h)</th><th>On-call share</th><th>Break (h)</th><th>Max daily IDs</th></tr></thead><tbody>'+byCenter+'</tbody></table></div></section>'+
   '<section class="panel section-gap"><div class="panel-head"><div><div class="panel-title">Daily Operations History</div><div class="panel-sub">TELUS calls are shown only when that separate call report has been imported</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>On call (h)</th><th>Available (h)</th><th>On-call share</th><th>TELUS service</th><th>TELUS outbound</th></tr></thead><tbody>'+byDay+'</tbody></table></div><div class="footnote">Historical observations only: no real-time agent status, inferred scheduled shifts or comparisons to unverified staffing targets.</div></section>');
}
function download(filename,body,mime){const blob=new Blob([body],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
const backup=()=>download('jim-wfm-private-service-history.json',JSON.stringify(store,null,2),'application/json');
function exportCSV(center){const s=summary(center),rows=[['Date','On Call Hours','Available Hours','Break Hours','Offline Hours','On-call Share Percent','TELUS Service Calls','TELUS Outbound Calls']];for(const d of s.days)rows.push([d.date,(d.onCall/60).toFixed(2),(d.available/60).toFixed(2),(d.break/60).toFixed(2),(d.offline/60).toFixed(2),pct(d.onCall,d.onCall+d.available),d.service,d.outbound]);download('jim-wfm-service-last-30-days.csv',rows.map(r=>r.join(',')).join('\r\n'),'text/csv')}
function clear(){store=empty();localStorage.removeItem(KEY)}
window.ServiceHistory={render,importFiles,backup,exportCSV,clear,summary,period};
})();