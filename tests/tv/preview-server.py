"""Local-only UI stress fixture. No production data, credentials or game writes.
Run: python3 tests/tv/preview-server.py, open http://127.0.0.1:4174/tv/?office=1&preview=1&qa=1
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[2])
FIXTURE = r'''<script>
// Explicitly fictional fixtures, injected only by this localhost test server.
const metric=(rounds=250000,wagered=999999999999,paid=888888888888)=>({rounds,active_players:26,wagered,paid,player_net:paid-wagered,house_net:wagered-paid,financial_complete:true});
const games=['var_challenge','crash','higher_lower','slots','businka_slots','blackjack','wheel','roulette','dice','plinko','horse','mines','coinflip','keno','tower','rps','offside','scratch','penalty','eleven_meters','durak'].map((game,i)=>({game,...metric(10000-i*100,999999999999-i,888888888888-i)}));
const people=Array.from({length:26},(_,i)=>({name:i===0?'Тестовый участник с очень длинным составным именем и фамилией':'Тестовый участник '+(i+1),avatar:i===1?'/missing-avatar.png':null,...metric(100-i,999999999999, i%2?888888888888:1111111111111)}));
let qaOffline=false,qaSignedOut=false;const qaListeners=[];
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:qaSignedOut?null:{access_token:'fictional-test-token',expires_at:Date.now()/1000+3600}}}),onAuthStateChange:fn=>{qaListeners.push(fn);return {data:{subscription:{unsubscribe(){}}}}}}})};
const originalFetch=window.fetch.bind(window);
window.fetch=async(url,options)=>{
 if(String(url).includes('/functions/v1/tv-stats-v2')){
  if(qaOffline)throw Error('Local test: offline');
  const office=String(url).includes('office=1')&&!qaSignedOut;
  const d={ok:true,version:2,timezone:'Asia/Nicosia',generated_at:new Date().toISOString(),data_version:'LOCAL TEST FIXTURE',personal_data:office,participants:office?{today:people,last_24h:people}:null,today:metric(),last_24h:metric(),week:metric(),month:metric(),all_time:metric(),hourly:Array.from({length:24},(_,hour)=>({hour,...metric(hour%4===0?0:hour*100, hour*1000000000, hour%2?hour*1500000000:hour*500000000)})),daily:Array.from({length:14},(_,i)=>({day:'2026-11-'+String(i+15).padStart(2,'0'),...metric(i*100)})),games:{today:games,last_24h:games,week:games,month:games,all_time:games},editorial_events:[{kind:'round_completed',count:100},{kind:'activity_digest',count:2}]};
  return new Response(JSON.stringify(d),{status:200});
 }
 return originalFetch(url,options);
};
window.addEventListener('DOMContentLoaded',()=>{
 document.getElementById('channel').textContent='ТЕСТОВЫЕ ДАННЫЕ · LOCAL QA';
 const tools=document.querySelector('.previewTools');
 for(const [label,fn] of [['QA: потеря связи',()=>{qaOffline=true;window.dispatchEvent(new Event('offline'))}],['QA: выход',()=>{qaSignedOut=true;qaListeners.forEach(fn=>fn('SIGNED_OUT',null))}]]){const b=document.createElement('button');b.textContent=label;b.onclick=fn;tools.append(b)}
 const badge=document.createElement('div');badge.textContent='ТЕСТОВЫЕ ДАННЫЕ · НЕ РЕАЛЬНАЯ СТАТИСТИКА';badge.style.cssText='position:fixed;bottom:0;right:0;z-index:99;background:#8b2340;color:white;padding:6px;font:16px Arial';document.body.append(badge);
});
</script>'''
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/tv/?') and 'qa=1' in self.path:
            html=Path('tv/index.html').read_text().replace('<script type="module"',FIXTURE+'<script type="module"')
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(html.encode())
        else: super().do_GET()
ThreadingHTTPServer(('127.0.0.1',4174),Handler).serve_forever()
