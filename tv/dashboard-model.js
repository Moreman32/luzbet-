export const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
export const fmt=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':number.format(Number(v));
export const money=v=>fmt(v)+(v===null||v===undefined?'':' ЛК');
export const sign=v=>v>0?'positive':v<0?'negative':'neutral';
export const signed=v=>v>0?'+'+money(v):money(v);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const dateLabel=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(8)+'.'+d.slice(5,7):'—';
export const pageItems=(items,page,size=5)=>items.slice((page%Math.max(1,Math.ceil(items.length/size)))*size,(page%Math.max(1,Math.ceil(items.length/size))+1)*size);
export function validSnapshot(d){return d?.ok===true&&d.version===2&&d.timezone==='Asia/Nicosia'&&Number.isFinite(Date.parse(d.generated_at))&&d.today&&Array.isArray(d.hourly)&&d.hourly.length===24&&Array.isArray(d.daily)&&d.daily.length===14&&d.games&&Array.isArray(d.editorial_events)}
export function screenPlan(data,office){
 const groups=[[{kind:'overview'}],[],[],[],[{kind:'events'}]];
 for(let p=0;p<Math.max(1,Math.ceil((data?.games?.today?.length||0)/5));p++)groups[1].push({kind:'games',page:p});
 if(office&&data?.participants)for(const period of ['today','last_24h'])for(let p=0;p<Math.max(1,Math.ceil((data.participants[period]?.length||0)/5));p++)groups[2].push({kind:'participants',period,page:p});
 for(const period of ['week','month','all_time'])for(let p=0;p<Math.max(1,Math.ceil((data?.games?.[period]?.length||0)/5));p++)groups[3].push({kind:'history',period,page:p});
 // Interleave categories so even a very large participant list cannot delay events past the news break.
 const plan=[];for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const group of groups)if(group[i])plan.push(group[i]);
 return plan;
}

export function barChart(items,key,label,{financial=false}={}){
 const max=Math.max(1,...items.map(x=>Math.abs(Number(x[key])||0)));
 const width=1120,height=270,bottom=215,top=38,step=width/Math.max(1,items.length);
 const zero=financial?125:bottom,scale=(financial?85:bottom-top)/max;
 const bars=items.map((x,i)=>{const v=Number(x[key])||0,h=Math.abs(v)*scale,y=v>=0?zero-h:zero;
 return `<g><title>${esc(label(x))}: ${fmt(v)}</title><rect x="${i*step+step*.19}" y="${y}" width="${step*.62}" height="${h}" rx="3" fill="${financial?(v<0?'#f38989':'#78d7af'):'#dcb975'}"/><text x="${(i+.5)*step}" y="${v>=0?y-10:y+h+23}" text-anchor="middle" class="chart-value">${v&&(items.length<=14||i%3===0||i===items.length-1)?fmt(v):''}</text><text x="${(i+.5)*step}" y="252" text-anchor="middle" class="chart-label">${esc(label(x))}</text></g>`;
 }).join('');
 return `<svg class="db-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${financial?'Чистый итог игроков':'Завершённые раунды'}"><path d="M0 ${zero} H1120" stroke="#62738b"/><text x="0" y="24" class="chart-label">${financial?'ЛК':'раундов'} · максимум ${fmt(max===1&&!items.some(x=>Number(x[key]))?0:max)}</text>${bars}</svg>`;
}
export function financialChart(items){
 const series=[['wagered','Ставки','#e7c58c'],['paid','Выплаты','#a5c8ff'],['player_net','Итог игроков','#78d7af']];
 const values=items.flatMap(x=>series.map(([k])=>Number(x[k])||0)),lo=Math.min(0,...values),hi=Math.max(1,...values),range=hi-lo;
 const y=v=>210-(v-lo)/range*170,x=i=>35+i*1035/Math.max(1,items.length-1);
 return `<div class="db-chart-legend">${series.map(([,label,color])=>`<span style="--series:${color}">${label}</span>`).join('')}</div><svg class="db-chart" viewBox="0 0 1120 270" role="img" aria-label="Ставки, выплаты и итог игроков по часам"><path d="M35 ${y(0)} H1070" stroke="#62738b"/><text x="35" y="24" class="chart-label">${fmt(lo)} … ${fmt(hi===1&&values.every(v=>!v)?0:hi)} ЛК</text>${series.map(([key,,color])=>`<polyline fill="none" stroke="${color}" stroke-width="3" points="${items.map((v,i)=>`${x(i)},${y(Number(v[key])||0)}`).join(' ')}"/>`).join('')}${items.map((v,i)=>i%3===0||i===items.length-1?`<text x="${x(i)}" y="250" text-anchor="middle" class="chart-label">${String(v.hour).padStart(2,'0')}:00</text>`:'').join('')}</svg>`;
}
