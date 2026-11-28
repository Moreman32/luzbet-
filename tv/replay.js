import {SUPABASE_URL,SUPABASE_KEY,tvAuth} from "./office-auth.js?v=2";
import {GAMES} from "./games.js?v=2";
const enabled=new URLSearchParams(location.search).get("office")==="1";
const names=Object.fromEntries(Object.entries(GAMES).map(([id,[name]])=>[id,name]));
let client=tvAuth,seen=new Set(),blockedUntil=0;
try{seen=new Set(JSON.parse(sessionStorage.getItem("lb-tv-replay-seen")||"[]").slice(-500))}catch{}
const svgNS="http://www.w3.org/2000/svg";
function node(tag,props={},label){const n=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(props))n.setAttribute(k,String(v));if(label!==undefined)n.textContent=String(label);return n}
function draw(game,result){const s=node("svg",{viewBox:"0 0 600 300",role:"img","aria-label":"Схематическое изображение архивного результата"});const add=(tag,p,t)=>s.appendChild(node(tag,p,t));const rect=(x,y,w,h,fill="#263b50")=>add("rect",{x,y,width:w,height:h,rx:10,fill,stroke:"#8295aa","stroke-width":2});const txt=(x,y,t,size=24)=>add("text",{x,y,fill:"#f4e3bd","text-anchor":"middle","font-size":size,"font-weight":700},t);const circle=(cx,cy,r,fill="#263b50")=>add("circle",{cx,cy,r,fill,stroke:"#b3a27e","stroke-width":2});const val=(v)=>typeof v==="number"&&Number.isFinite(v)||typeof v==="string"&&v.length<40?String(v):"—";
let summary="Сохранённый результат";
switch(game){
case "roulette":circle(300,130,105);circle(300,130,75,"#172938");txt(300,146,val(result.number),56);summary="Выпавшее число: "+val(result.number);break;
case "blackjack":rect(180,35,240,160);txt(300,85,"ДИЛЕР",21);txt(300,151,val(result.dealerTotal),58);summary="Итог дилера: "+val(result.dealerTotal);break;
case "mines":for(let y=0;y<4;y++)for(let x=0;x<5;x++)rect(180+x*48,18+y*48,40,40);summary="Открыто клеток: "+val(result.revealed_count);break;
case "plinko":for(let y=0;y<6;y++)for(let x=0;x<=y;x++)circle(300+(x-y/2)*44,18+y*32,5);rect(225,214,150,40);txt(300,241,val(result.bucket));summary="Конечная ячейка: "+val(result.bucket);break;
case "higher_lower":for(let i=0;i<3;i++){rect(160+i*95,48,82,136);txt(201+i*95,125,"?",44)}summary="Записано шагов: "+val(result.steps);break;
case "crash":add("path",{d:"M100 35 V200 H500",fill:"none",stroke:"#8196aa","stroke-width":3});txt(300,130,val(result.crash),50);summary="Сохранённый итог: "+val(result.crash);break;
case "dice":rect(220,42,160,160);txt(300,139,val(result.roll),44);summary="Выпавшее значение: "+val(result.roll);break;
case "horse":for(let i=0;i<4;i++)add("path",{d:"M80 "+(40+i*45)+" H520",stroke:"#60758a","stroke-width":2,"stroke-dasharray":"8 6"});txt(300,130,"ФИНИШ",40);summary="Победитель: "+val(result.winner);break;
case "businka_slots":for(let i=0;i<3;i++){rect(160+i*95,48,82,136);txt(201+i*95,125,"•",44)}summary="Записано вращений: "+val(result.spins);break;
}
return {s,summary}}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
export function clearReplay(){const el=document.getElementById("replay");if(el){el.hidden=true;el.replaceChildren()}}
export async function nextReplay(){if(!enabled||Date.now()<blockedUntil||!tvAuth)return null;try{const {data}=await client.auth.getSession();if(!data.session)return null;const r=await fetch(SUPABASE_URL+"/functions/v1/tv-office-replays",{headers:{Authorization:"Bearer "+data.session.access_token,apikey:SUPABASE_KEY},cache:"no-store",signal:AbortSignal.timeout(5000)});if(!r.ok){blockedUntil=Date.now()+60000;return null}const body=await r.json();return (body.version===1&&Array.isArray(body.replays)?body.replays:[]).find(x=>x&&names[x.game]&&typeof x.id==="string"&&!seen.has(x.id)&&x.participant&&x.result)||null}catch{blockedUntil=Date.now()+60000;return null}}
export function showReplay(r){const el=document.getElementById("replay");if(!el||!r)return false;clearReplay();const name=String(r.participant.name||"Участник").slice(0,64);const person=element("div","rp-person");const avatar=element("div","rp-avatar",name.split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"?");try{const url=new URL(r.participant.avatar,location.origin);if(r.participant.avatar&&url.origin===location.origin){const im=element("img");im.alt="";im.referrerPolicy="no-referrer";im.onerror=()=>im.remove();im.src=url.href;avatar.append(im)}}catch{}person.append(avatar,element("div","rp-name",name),element("div","rp-meta","Участник архивного эпизода"));const stage=element("div","rp-stage"),d=draw(r.game,r.result);stage.append(d.s,element("div","rp-summary",d.summary));const bottom=element("div","rp-bottom");let date="Архив";try{date=new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Nicosia",dateStyle:"short",timeStyle:"short"}).format(new Date(r.finished_at))}catch{}bottom.append(element("span","","Схема результата • не запись хода игры"),element("span","",date));const bar=element("div","rp-bar");bar.append(element("i"));el.append(element("div","rp-title","АРХИВ LUZBET  /  "+names[r.game]),person,stage,bottom,bar);el.hidden=false;seen.add(r.id);try{sessionStorage.setItem("lb-tv-replay-seen",JSON.stringify([...seen].slice(-500)))}catch{}return true}
export function officeEnabled(){return enabled}
