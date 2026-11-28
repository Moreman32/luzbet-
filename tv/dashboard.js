const URL='https://kdsowktuirtkxnmtyoaz.supabase.co/functions/v1/tv-stats';
const $=id=>document.getElementById(id);
const nf=new Intl.NumberFormat('ru-RU');
const fmt=n=>Number.isFinite(Number(n))?nf.format(Number(n)):'—';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const holder=$('dashboard');
let snapshot=null,lastSuccess=0,failures=0,requesting=false;
const cached=(()=>{try{const x=JSON.parse(localStorage.getItem('luzbet-tv-stats-v1')||'null');return x&&x.data?.version===1&&Date.now()-x.saved<86400000?x:null}catch{return null}})();
if(cached){snapshot=cached.data;lastSuccess=cached.saved;render()}
function kpi(name,val){return '<div class="db-kpi"><span>'+name+'</span><b>'+fmt(val)+'</b></div>'}
function render(){
 if(!snapshot){holder.innerHTML='<div class="db-head"><strong>LUZBET • LIVE ANALYTICS</strong></div><p class="db-empty">Статистика временно недоступна. Эфир продолжается.</p>';return}
 const p=snapshot.periods||{};const hours=Array.isArray(snapshot.hours)?snapshot.hours:[];
 const days=Array.isArray(snapshot.days)?snapshot.days:[];const games=Array.isArray(snapshot.games)?snapshot.games:[];
 const maxDay=Math.max(1,...days.map(x=>Number(x.rounds)||0));const maxGame=Math.max(1,...games.map(x=>Number(x.rounds)||0));
 const stale=Date.now()-lastSuccess>120000||snapshot.stale;
 holder.innerHTML='<div class="db-head"><strong>LUZBET <span style="color:#e4c586">/ АНАЛИТИКА ЭФИРА</span></strong><small>Завершённые игровые раунды • Кипр</small></div>'+
 '<div class="db-grid">'+kpi('Сегодня',p.today?.rounds)+kpi('Неделя',p.week?.rounds)+kpi('Месяц',p.month?.rounds)+kpi('За всё время',p.all?.rounds)+'</div>'+
 '<div class="db-bottom"><section class="db-panel"><h3>АКТИВНОСТЬ ПО ДНЯМ · 14 ДНЕЙ</h3><div class="db-bars">'+days.map((x,i)=>'<div class="db-bar" title="'+esc(x.day)+': '+fmt(x.rounds)+'" style="--bar-height:'+Math.max(1,Math.round(100*(Number(x.rounds)||0)/maxDay))+'%"><em>'+(i%2===0?esc(x.day.slice(5)):'')+'</em></div>').join('')+'</div></section>'+
 '<section class="db-panel"><h3>ПОПУЛЯРНЫЕ ИГРЫ</h3><div class="db-games">'+games.slice(0,6).map(g=>'<div class="db-game"><label>'+esc(g.game)+'</label><b>'+fmt(g.rounds)+'</b><div class="db-track"><i style="--bar-height:'+Math.round(100*Number(g.rounds)/maxGame)+'%"></i></div></div>').join('')+'</div></section></div>'+
 '<div class="db-status">'+(stale?'● НЕТ СВЕЖИХ ДАННЫХ':'● ДАННЫЕ АКТУАЛЬНЫ')+' · Обновлено '+new Date(lastSuccess).toLocaleTimeString('ru-RU',{timeZone:'Asia/Nicosia',hour:'2-digit',minute:'2-digit'})+' · сегодня по часам: '+hours.reduce((a,x)=>a+(Number(x.rounds)||0),0)+'</div>';
}
async function refresh(){
 if(requesting)return;requesting=true;
 try{
 const res=await fetch(URL,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('HTTP '+res.status);
 const data=await res.json();
 if(!data.ok||data.version!==1||data.personal_data!==false||!data.periods||!Array.isArray(data.days))throw Error('Invalid data');
 snapshot=data;lastSuccess=Date.now();failures=0;
 try{localStorage.setItem('luzbet-tv-stats-v1',JSON.stringify({data,saved:lastSuccess}))}catch{}
 render();
 }catch(e){console.warn('TV stats',e);failures++;render()}
 finally{requesting=false}
}
export function showDashboard(){holder.hidden=false;render()}
export function hideDashboard(){holder.hidden=true}
export function dashboardIsVisible(){return !holder.hidden}
export function dashboardRefresh(){return refresh()}
render();void refresh();setInterval(()=>{if(document.visibilityState==='visible')void refresh()},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastSuccess>60000)void refresh()});
