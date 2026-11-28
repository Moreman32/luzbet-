import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
test('480-second analytical pause returns to news and back without adding timers',async()=>{
 const nodes=new Map(),timers=[],timeouts=[];let shows=0,hides=0;
 const el=()=>({hidden:false,textContent:'',style:{setProperty(){}},clientWidth:1920,scrollWidth:2000,scrollHeight:1,offsetWidth:1,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return null},src:''});
 global.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id)},body:{classList:{toggle(){}}},documentElement:{}};
 global.window={addEventListener(){}};global.location={search:'?preview=1'};
 global.matchMedia=()=>({matches:false});global.getComputedStyle=()=>({lineHeight:'40px'});
 global.Image=class{set src(v){queueMicrotask(()=>this.onload?.())}};
 const old={fetch:global.fetch,setInterval:global.setInterval,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 global.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length};global.setTimeout=(fn,ms)=>{timeouts.push({fn,ms});return timeouts.length};global.clearTimeout=()=>{};
 global.fetch=async path=>({ok:true,json:async()=>String(path).includes('host.json')?{desk:{idle:'assets/host/desk-idle.webp'},calculator:{idle:'assets/host/calculator-idle.webp'}}:{version:1,stories:[{id:'test',program:'news',headline:'Тестовый выпуск',body:'Тестовая новость для проверки сетки эфира.'}]}});
 global.__tvEngineTest={show:()=>shows++,hide:()=>hides++};
 try{
  let source=await readFile(new URL('../../tv/engine.js',import.meta.url),'utf8');
  source=source.replace('"./replay.js?v=2"',JSON.stringify(moduleURL('export const nextReplay=async()=>null,showReplay=()=>false,clearReplay=()=>{},officeEnabled=()=>false;'))).replace('"./dashboard.js?v=2"',JSON.stringify(moduleURL('export const showDashboard=()=>globalThis.__tvEngineTest.show(),hideDashboard=()=>globalThis.__tvEngineTest.hide(),dashboardRefresh=async()=>{},nextDashboardScreen=()=>{};')));
  await import(moduleURL(source));for(let i=0;i<20;i++)await Promise.resolve();assert.equal(shows,1);assert.equal(timers.length,2);
  const tick=timers.find(t=>t.ms===1000).fn;
  for(let i=0;i<479;i++)tick();assert.equal(hides,0);tick();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(hides,1);
  for(let i=0;i<3;i++)for(const t of timeouts.splice(0))if(t.ms<3000)t.fn();
  for(let i=0;i<60;i++)tick();assert.ok(shows>=2);assert.equal(timers.length,2);
 }finally{Object.assign(global,old);delete global.__tvEngineTest}
});
