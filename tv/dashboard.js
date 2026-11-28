import {gameInfo} from './games.js?v=2';
import {tvAuth,officeRequested,SUPABASE_URL,SUPABASE_KEY} from './office-auth.js?v=2';
import {fmt,money,signed,sign,esc,dateLabel,pageItems,screenPlan,validSnapshot,barChart,financialChart} from './dashboard-model.js?v=2';
const holder=document.getElementById('dashboard'),endpoint=SUPABASE_URL+'/functions/v1/tv-stats-v2';
let snapshot=null,publicSnapshot=null,authorized=false,expiresAt=0,requesting=false,failed=false,index=0,screenAt=Date.now(),plan=[],revision=0,lastMarkup='',lastScreenKey='',numberFrame=0;
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Nicosia',year:'numeric',month:'2-digit',day:'2-digit'});
let currentDay=calendar.format(new Date());
const time=v=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Nicosia',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
const names={overview:'Общая картина',games:'Игры за сегодня',participants:'Игроки',history:'Историческая аналитика',events:'События дня'};
const periods={today:'Сегодня',last_24h:'Последние 24 часа',week:'Эта неделя',month:'Этот месяц',all_time:'Всё время'};
const panel=(title,body,cls='')=>`<section class="db-panel ${cls}"><h3>${title}</h3>${body}</section>`;
const empty=(text='За сегодня завершённых раундов пока нет')=>`<div class="db-empty"><span>—</span><strong>${text}</strong><p>Бухгалтерия сохраняет подозрительное спокойствие.</p></div>`;
function kpi(label,value,sub='',cls=''){return `<div class="db-kpi"><span>${label}</span><b class="${cls}" style="font-size:${value.length>15?1.3:value.length>11?1.65:2.15}cqw;white-space:nowrap">${value}</b><small>${sub}</small></div>`}
function kpis(p){return `<div class="db-kpis">${kpi('Сыграно раундов',fmt(p.rounds),'Только завершённые')}${kpi('Активных игроков',fmt(p.active_players),'Уникальные участники')}${kpi('Сумма ставок',money(p.wagered),'Виртуальные ЛК')}${kpi('Сумма выплат',money(p.paid),'Виртуальные ЛК')}${kpi('Итог игроков',signed(p.player_net),'Выплаты − ставки',sign(p.player_net))}${kpi('Итог конторы',signed(p.house_net),'Ставки − выплаты',sign(p.house_net))}</div>`}
function historyStrip(){return `<div class="db-history-strip">${[['Неделя · раунды',snapshot.week.rounds],['Месяц · раунды',snapshot.month.rounds],['Всё время · раунды',snapshot.all_time.rounds],['Игроки · неделя',snapshot.week.active_players],['Игроки · месяц',snapshot.month.active_players]].map(([a,b])=>`<div><span>${a}</span><b>${fmt(b)}</b></div>`).join('')}</div>`}
function distribution(items,page=0){const total=items.reduce((s,x)=>s+Number(x.rounds||0),0);return !total?empty('Распределение появится после завершённых раундов'):`<div class="db-distribution">${pageItems(items,page).map(g=>{const [name,icon]=gameInfo(g.game),pct=100*g.rounds/total;return `<div><div class="db-distribution-label"><span>${icon} ${esc(name)}</span><b>${fmt(g.rounds)} <small>· ${pct.toLocaleString('ru-RU',{maximumFractionDigits:1})}%</small></b></div><div class="db-track"><i style="width:${pct}%"></i></div></div>`}).join('')}</div>`}
function gameTable(items,page){return !items.length?empty():`<div class="db-table"><div class="db-row db-labels"><span>Игра</span><span>Раунды</span><span>Ставки, ЛК</span><span>Выплаты, ЛК</span><span>Итог игроков, ЛК</span></div>${pageItems(items,page).map(g=>{const [name,icon]=gameInfo(g.game);return `<div class="db-row"><strong><i>${icon}</i>${esc(name)}</strong><b>${fmt(g.rounds)}</b><span>${fmt(g.wagered)}</span><span>${fmt(g.paid)}</span><b class="${sign(g.player_net)}">${g.player_net>0?'+':''}${fmt(g.player_net)}</b></div>`}).join('')}</div>`}
function overview(){return kpis(snapshot.today)+`<div class="db-overview-layout">${panel('Активность по часам <small>Сегодня · 00:00–23:59</small>',barChart(snapshot.hourly,'rounds',x=>String(x.hour).padStart(2,'0'))+(!snapshot.today.rounds?'<p class="db-quiet">Отдел аналитики обнаружил идеально ровный график</p>':''))}${panel('Финансовый отдел докладывает',`<div class="db-finance-total"><span>Чистый итог игроков</span><b style="font-size:${signed(snapshot.today.player_net).length>17?2:3}cqw" class="${sign(snapshot.today.player_net)}">${signed(snapshot.today.player_net)}</b></div><p class="db-caption">${snapshot.today.rounds?'Учтены ставки и выплаты завершённых раундов.':'Редкий случай: бухгалтерия отдыхает.'}</p><div class="db-finance-pair"><span>Ставки <b>${money(snapshot.today.wagered)}</b></span><span>Выплаты <b>${money(snapshot.today.paid)}</b></span></div>`)}</div>`+historyStrip()}
function games(s){const items=snapshot.games.today||[];return `<div class="db-section-note">Сегодня с 00:00 · сортировка по завершённым раундам <span>Страница ${(s.page||0)+1} / ${Math.max(1,Math.ceil(items.length/5))}</span></div>`+panel('Департамент учёта виртуальных ЛК',gameTable(items,s.page),'db-game-panel')+`<div class="db-game-bottom">${panel('Распределение активности',distribution(items,s.page))}${panel('Финансовая динамика <small>Сегодня · ставки, выплаты и итог по часам</small>',financialChart(snapshot.hourly))}</div>`}
function avatar(p){const initials=String(p.name||'Участник').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();let image='';try{const url=new URL(p.avatar,location.origin);if(p.avatar&&(url.origin===location.origin||url.origin===SUPABASE_URL)&&['http:','https:'].includes(url.protocol))image=`<img src="${esc(url.href)}" alt="" referrerpolicy="no-referrer">`}catch{}return `<div class="db-avatar">${esc(initials)}${image}</div>`}
function participants(s){const items=snapshot.participants?.[s.period]||[];return `<div class="db-section-note">${periods[s.period]} · только участники с согласием на офисный эфир <span>Страница ${s.page+1} / ${Math.max(1,Math.ceil(items.length/5))}</span></div>`+panel('Президент Бусинка принимает отчёт',!items.length?empty('За выбранный период завершённых раундов нет'):`<div class="db-table db-people"><div class="db-row db-labels"><span>Участник</span><span>Раунды</span><span>Ставки, ЛК</span><span>Выплаты, ЛК</span><span>Итог, ЛК</span></div>${pageItems(items,s.page).map(p=>`<div class="db-row"><strong>${avatar(p)}<span style="font-size:${String(p.name||'').length>40?1.1:1.35}cqw">${esc(p.name||'Участник')}</span></strong><b>${fmt(p.rounds)}</b><span>${fmt(p.wagered)}</span><span>${fmt(p.paid)}</span><b class="${sign(p.player_net)}">${p.player_net>0?'+':''}${fmt(p.player_net)}</b></div>`).join('')}</div>`,'db-participants-panel')+`<p class="db-caption">Итог = выплаты − ставки. Виртуальные ЛК. Показаны только завершённые раунды.</p>`}
function history(s){const p=snapshot[s.period],items=snapshot.games[s.period]||[];return `<div class="db-period-cards">${['week','month','all_time'].map(key=>`<div class="${key===s.period?'selected':''}"><span>${periods[key]}</span><b>${fmt(snapshot[key].rounds)} <small>раундов</small></b><p>${fmt(snapshot[key].active_players)} активных игроков</p></div>`).join('')}</div><div class="db-history-body">${panel('Активность за 14 дней',barChart(snapshot.daily,'rounds',x=>dateLabel(x.day))+`<p class="db-caption">Календарные дни Кипра · неделя начинается в понедельник</p>`)}${panel(`Популярность · ${periods[s.period]} <small>${s.page+1} / ${Math.max(1,Math.ceil(items.length/5))}</small>`,distribution(items,s.page))}</div><p class="db-caption db-limitation">${p.financial_complete?`Ставки: ${money(p.wagered)} · выплаты: ${money(p.paid)} · итог игроков: ${signed(p.player_net)}`:'Исторические суммы до 25.09.2026 не подтверждены. Показаны раунды и активность.'}</p>`}
function events(){const e=snapshot.editorial_events||[];return `<div class="db-event-hero"><span>МИНИСТЕРСТВО ФИНАНСОВОГО НЕДОУМЕНИЯ</span><h2>${snapshot.today.rounds?'Факты на столе.\nБухгалтерия спокойна.':'Президент Бусинка объявила статистическую тишину'}</h2><p>${snapshot.today.rounds?'Подтверждённые данные текущего календарного дня.':'За сегодня завершённых раундов пока нет.'}</p></div><div class="db-event-cards">${kpi('Раундов завершено сегодня',fmt(snapshot.today.rounds),'Серверная статистика')}${kpi('Подтверждено Event Engine',fmt(e.filter(x=>x.kind==='round_completed').reduce((a,x)=>a+Number(x.count),0)),'События завершения раундов')}${kpi('Сводок активности',fmt(e.filter(x=>x.kind==='activity_digest').reduce((a,x)=>a+Number(x.count),0)),'Проверенные сводки редакции')}</div><p class="db-caption">События редакции — отдельные подтверждённые сообщения, их количество может отличаться от числа раундов.</p>`}
function stale(){return failed||snapshot?.stale||Date.now()-Date.parse(snapshot?.generated_at)>120000}
function status(){const el=holder.querySelector('.db-status');if(el&&snapshot)el.innerHTML=`<span class="${stale()?'db-stale':''}">${stale()?'Данные устарели · восстанавливаем связь':'Данные актуальны'} · ${time(snapshot.generated_at)}</span><span>${authorized?'Авторизованный офисный эфир':'Обезличенный публичный эфир'} · Кипр · виртуальные ЛК</span>`}
function animateNumbers(previous){
 if(!previous.length||typeof requestAnimationFrame!=='function'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const nodes=[...holder.querySelectorAll('.db-kpi>b')];
 const changes=nodes.flatMap((node,i)=>{const end=node.textContent,old=previous[i];if(!old||end===old||end.includes('—'))return [];
 const parse=s=>Number(s.replace(/[^0-9+-]/g,''));const from=parse(old),to=parse(end);
 return Number.isSafeInteger(from)&&Number.isSafeInteger(to)?[{node,from,to,end,unit:end.includes('ЛК'),plus:end.startsWith('+')}]:[]});
 if(!changes.length)return;const start=performance.now();
 const frame=now=>{const progress=Math.min(1,(now-start)/650),eased=1-Math.pow(1-progress,3);for(const c of changes){const n=Math.round(c.from+(c.to-c.from)*eased);c.node.textContent=progress===1?c.end:(c.plus&&n>0?'+':'')+fmt(n)+(c.unit?' ЛК':'')}if(progress<1)numberFrame=requestAnimationFrame(frame);else numberFrame=0};
 numberFrame=requestAnimationFrame(frame);
}
function render(){
 if(!snapshot){lastMarkup='';holder.innerHTML=`<div class="db-head"><strong>Бюро статистики</strong><span>LUZBET LIVE / 2.0</span></div>${empty('Статистика временно недоступна. Эфир продолжается.')}<div class="db-status">Повторное подключение каждые 60 секунд</div>`;return}
 plan=screenPlan(snapshot,authorized);index%=plan.length;const s=plan[index];
 const title=s.kind==='participants'?`${periods[s.period]} · игроки`:names[s.kind];
 const markup=`<div class="db-head"><div><span class="db-eyebrow">LUZBET LIVE / АНАЛИТИКА 2.0</span><h2>${title}</h2></div><div class="db-head-right"><span>${new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Nicosia',day:'numeric',month:'long'}).format(new Date())}</span><small>${index+1} / ${plan.length} · 25 с на экран</small></div></div><div class="db-content db-${s.kind}">${({overview,games,participants,history,events}[s.kind])(s)}</div><div class="db-status"></div><div class="db-progress"><i></i></div>`;
 if(markup===lastMarkup){status();return}
 if(numberFrame){cancelAnimationFrame(numberFrame);numberFrame=0}
 const screenKey=[s.kind,s.period,s.page].join(':');
 const previous=lastScreenKey===screenKey?[...holder.querySelectorAll('.db-kpi>b')].map(n=>n.textContent):[];
 lastScreenKey=screenKey;lastMarkup=markup;holder.innerHTML=markup;animateNumbers(previous);
 holder.querySelectorAll('img').forEach(im=>im.addEventListener('error',()=>im.remove(),{once:true}));
 const progress=holder.querySelector('.db-progress i');progress.style.animationDelay=`-${Math.min(24,(Date.now()-screenAt)/1000)}s`;status();
}
function forgetOffice(){authorized=false;expiresAt=0;if(snapshot?.personal_data)snapshot=publicSnapshot;index=0;screenAt=Date.now();render()}
function cachePublic(data){if(data.personal_data!==false||data.participants!==null)return;publicSnapshot=data;try{localStorage.setItem('luzbet-tv-stats-v2',JSON.stringify(data))}catch{}}
async function refresh(){
 if(requesting)return;requesting=true;const rev=revision;
 try{
  let token=null;
  if(officeRequested&&tvAuth){const {data}=await tvAuth.auth.getSession();token=data.session?.access_token;expiresAt=(data.session?.expires_at||0)*1000;if(!token)forgetOffice()}
  let res=await fetch(endpoint+(token?'?office=1':''),{headers:token?{Authorization:'Bearer '+token,apikey:SUPABASE_KEY}:{},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(rev!==revision)return;
  if(token&&(res.status===401||res.status===403)){forgetOffice();token=null;res=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(12000)})}
  if(!res.ok)throw Error('HTTP '+res.status);
  const data=await res.json();if(rev!==revision)return;
  if(!validSnapshot(data)||calendar.format(new Date(data.generated_at))!==currentDay||(!token&&data.personal_data!==false)||(token&&(!data.personal_data||!data.participants)))throw Error('Invalid snapshot');
  snapshot=data;authorized=!!token;failed=false;cachePublic({...data,personal_data:false,participants:null});render();
 }catch{failed=true;forgetOffice();status()}
 finally{requesting=false}
}
try{const cached=JSON.parse(localStorage.getItem('luzbet-tv-stats-v2')||'null');if(validSnapshot(cached)&&calendar.format(new Date(cached.generated_at))===currentDay&&cached.personal_data===false&&cached.participants===null&&Date.now()-Date.parse(cached.generated_at)<86400000){snapshot=cached;publicSnapshot=cached}}catch{}
export function showDashboard(){holder.hidden=false;screenAt=Date.now();render()}
export function nextDashboardScreen(){index++;screenAt=Date.now();render()}
export function hideDashboard(){holder.hidden=true}
export function dashboardIsVisible(){return !holder.hidden}
export function dashboardRefresh(){return refresh()}
if(tvAuth)tvAuth.auth.onAuthStateChange((event,session)=>{if(!session||event==='SIGNED_OUT'){revision++;forgetOffice()}else expiresAt=(session.expires_at||0)*1000});
window.addEventListener('storage',e=>{if(e.key==='luzbet2-auth'||e.key===null){revision++;forgetOffice();void refresh()}});
window.addEventListener('online',()=>void refresh());
window.addEventListener('offline',()=>{failed=true;forgetOffice();status()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(authorized)forgetOffice();void refresh()}});
setInterval(()=>{const day=calendar.format(new Date());if(day!==currentDay){currentDay=day;revision++;snapshot=null;publicSnapshot=null;forgetOffice();void refresh()}if(authorized&&Date.now()>=expiresAt)forgetOffice();if(holder.hidden||document.body.classList.contains('paused')){screenAt=Date.now();return}if(Date.now()-screenAt>=25000){index++;screenAt=Date.now();render()}status()},1000);
setInterval(()=>{if(document.visibilityState==='visible')void refresh()},60000);
render();void refresh();
