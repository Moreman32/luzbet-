import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
const origins=new Set(['https://luzbet.lol','https://www.luzbet.lol','http://localhost:4173','http://127.0.0.1:4173']);
let cache:{at:number,data:Record<string,unknown>}|null=null;
let flight:Promise<Record<string,unknown>>|null=null;
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Nicosia',year:'numeric',month:'2-digit',day:'2-digit'});
const hits=new Map<string,{n:number,until:number}>();
Deno.serve(async req=>{
 const office=new URL(req.url).searchParams.get('office')==='1';
 const origin=req.headers.get('Origin');
 const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':office?'private, no-store':'public, max-age=0, s-maxage=60','Vary':'Origin, Authorization','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,OPTIONS'};
 if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const json=(body:unknown,status=200)=>{if(status!==200)headers['Cache-Control']='no-store';return new Response(JSON.stringify(body),{status,headers})};
 if(origin&&!origins.has(origin))return json({error:'forbidden_origin'},403);
 if(req.method==='OPTIONS')return json({});
 if(req.method!=='GET')return json({error:'method_not_allowed'},405);
 const now=Date.now(),ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].slice(0,64),bucket=hits.get(ip);
 if(bucket&&bucket.until>now&&bucket.n>=90)return json({error:'rate_limited'},429);
 if(!bucket||bucket.until<=now)hits.set(ip,{n:1,until:now+60000});else bucket.n++;
 if(hits.size>10000)hits.clear();
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 let participants:unknown=null;
 // Personal data is never included in the shared cache; authenticate every office request.
 if(office){
  const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return json({error:'unauthorized'},401);
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user)return json({error:'unauthorized'},401);
  const result=await db.rpc('tv_stats_participants_v2',{p_viewer:data.user.id});
  if(result.error)return json({error:'unavailable'},503);
  if(result.data===null)return json({error:'forbidden'},403);
  participants=result.data;
 }
 try{
  if(!cache||now-cache.at>=60000||calendar.format(new Date(cache.at))!==calendar.format(new Date(now))){
   if(!flight)flight=(async()=>{
    const {data,error}=await db.rpc('tv_stats_snapshot_v2');
    if(error||data?.version!==2||data.personal_data!==false||data.participants!==null)throw Error('snapshot unavailable');
    cache={at:Date.now(),data};return data;
   })().finally(()=>{flight=null});
   await flight;
  }
  if(!cache)throw Error('no snapshot');
  return json({ok:true,...cache.data,participants,personal_data:office});
 }catch{
  // Office fallback still uses freshly authorized participants and never cached personal results.
  if(cache){headers['Cache-Control']='no-store';return json({ok:true,...cache.data,participants,personal_data:office,stale:true})}
  return json({error:'statistics_temporarily_unavailable'},503);
 }
});
