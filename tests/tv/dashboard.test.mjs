import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const dataURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const modelSource=await readFile(new URL('tv/dashboard-model.js',root),'utf8');
const m=await import(dataURL(modelSource));
const period={rounds:0,active_players:0,wagered:0,paid:0,player_net:0,house_net:0};
const sample=()=>({ok:true,version:2,timezone:'Asia/Nicosia',generated_at:new Date().toISOString(),personal_data:false,participants:null,today:{...period},week:{...period},month:{...period},all_time:{...period},last_24h:{...period},hourly:Array.from({length:24},(_,hour)=>({hour,rounds:0,wagered:0,paid:0,player_net:0})),daily:Array.from({length:14},(_,i)=>({day:`2026-11-${String(i+1).padStart(2,'0')}`,rounds:0})),games:{today:[],week:[],month:[],all_time:[]},editorial_events:[]});
test('unknown values stay unknown, zero and signed money are distinct',()=>{assert.equal(m.fmt(null),'—');assert.equal(m.fmt(undefined),'—');assert.equal(m.money(0),'0 ЛК');assert.equal(m.sign(0),'neutral');assert.match(m.signed(15),/^\+/);assert.equal(m.dateLabel('2026-11-28'),'28.11');assert.equal(m.esc('<img>'),'&lt;img&gt;')});
test('zero activity produces exactly zero height bars',()=>{const svg=m.barChart(sample().hourly,'rounds',x=>x.hour);const heights=[...svg.matchAll(/height="([^"]+)"/g)].map(x=>+x[1]);assert.equal(heights.length,24);assert.ok(heights.every(x=>x===0));assert.ok(!svg.includes('NaN'))});
test('large signed financial data keeps finite coordinates',()=>{const svg=m.financialChart([{hour:0,wagered:1e12,paid:2e12,player_net:1e12},{hour:1,wagered:9e12,paid:1e12,player_net:-8e12}]);assert.ok(!/NaN|Infinity/.test(svg));assert.equal((svg.match(/polyline/g)||[]).length,3)});
test('all games and all 26 players are paginated without truncation',()=>{const s=sample();s.games.today=Array.from({length:23},(_,i)=>({game:String(i)}));s.participants={today:Array.from({length:26},(_,i)=>({name:String(i)})),last_24h:[]};const p=m.screenPlan(s,true);assert.equal(p.filter(x=>x.kind==='games').length,5);assert.equal(p.filter(x=>x.kind==='participants'&&x.period==='today').length,6);assert.equal(new Set(p.filter(x=>x.kind==='participants'&&x.period==='today').flatMap(x=>m.pageItems(s.participants.today,x.page)).map(x=>x.name)).size,26);assert.ok(!m.screenPlan(s,false).some(x=>x.kind==='participants'))});
test('invalid payload versions and missing time buckets rejected',()=>{const s=sample();assert.ok(m.validSnapshot(s));s.hourly.pop();assert.ok(!m.validSnapshot(s))});
test('office response never persists personal data; network/auth loss clears names',async()=>{
 const timers=[],events={},saved=new Map(),status={innerHTML:''};
 const holder={hidden:false,innerHTML:'',querySelector:s=>s==='.db-status'?status:{style:{}},querySelectorAll:()=>[]};
 let callback,mode='office';
 global.document={getElementById:()=>holder,visibilityState:'visible',body:{classList:{contains:()=>false}},addEventListener:(k,v)=>events[k]=v};
 global.window={addEventListener:(k,v)=>events[k]=v};global.location={origin:'http://localhost:4173'};
 global.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 const oldInterval=global.setInterval,oldFetch=global.fetch;
 global.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length};
 const s=sample();s.personal_data=true;s.participants={today:[{name:'СЕКРЕТНЫЙ УЧАСТНИК',avatar:null,rounds:2,wagered:100,paid:50,player_net:-50}],last_24h:[]};
 global.fetch=async()=>{if(mode==='offline')throw Error('offline');return {ok:true,status:200,json:async()=>structuredClone(s)}};
 const authModule=`export const officeRequested=true,SUPABASE_URL='https://test.supabase.co',SUPABASE_KEY='public';export const tvAuth=globalThis.__tvTestAuth;`;
 global.__tvTestAuth={auth:{getSession:async()=>({data:{session:{access_token:'test-only',expires_at:Date.now()/1000+3600}}}),onAuthStateChange:fn=>{callback=fn}}};
 try{
  let source=await readFile(new URL('tv/dashboard.js',root),'utf8');
  source=source.replace("'./games.js?v=2'",JSON.stringify(dataURL(await readFile(new URL('tv/games.js',root),'utf8')))).replace("'./office-auth.js?v=2'",JSON.stringify(dataURL(authModule))).replace("'./dashboard-model.js?v=2'",JSON.stringify(dataURL(modelSource)));
  const d=await import(dataURL(source));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.length,2);d.nextDashboardScreen();d.nextDashboardScreen();assert.match(holder.innerHTML,/СЕКРЕТНЫЙ УЧАСТНИК/);
  assert.ok([...saved.values()].every(x=>!x.includes('СЕКРЕТНЫЙ')));assert.ok([...saved.values()].every(x=>JSON.parse(x).participants===null));
  mode='offline';await d.dashboardRefresh();assert.ok(!holder.innerHTML.includes('СЕКРЕТНЫЙ'));assert.match(status.innerHTML,/устарели/);
  callback('SIGNED_OUT',null);assert.ok(!holder.innerHTML.includes('СЕКРЕТНЫЙ'));
  assert.equal(timers.length,2);
 }finally{global.setInterval=oldInterval;global.fetch=oldFetch;delete global.__tvTestAuth}
});
