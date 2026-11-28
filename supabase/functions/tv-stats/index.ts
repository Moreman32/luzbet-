import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origins=new Set(["https://luzbet.lol","https://www.luzbet.lol","http://localhost:4173","http://127.0.0.1:4173"]);
let cache: {at:number,body:string}|null=null;
let inFlight:Promise<string>|null=null;
const hits=new Map<string,{n:number,until:number}>();
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 const cors:Record<string,string>={"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=30, s-maxage=60, stale-while-revalidate=120","Vary":"Origin","Access-Control-Allow-Methods":"GET, OPTIONS"};
 if(origin&&origins.has(origin))cors["Access-Control-Allow-Origin"]=origin;
 const respond=(data:string,status=200)=>new Response(data,{status,headers:cors});
 if(origin&&!origins.has(origin))return respond('{"ok":false,"error":"forbidden_origin"}',403);
 if(req.method==="OPTIONS")return respond("{}",200);
 if(req.method!=="GET")return respond('{"ok":false,"error":"method_not_allowed"}',405);
 const u=new URL(req.url);if(u.pathname.split("/").pop()!=="tv-stats")return respond('{"ok":false,"error":"not_found"}',404);
 const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim().slice(0,64);
 const now=Date.now();const bucket=hits.get(ip);
 if(bucket&&bucket.until>now&&bucket.n>=90)return respond('{"ok":false,"error":"rate_limited"}',429);
 if(!bucket||bucket.until<=now)hits.set(ip,{n:1,until:now+60000});else bucket.n++;
 if(hits.size>10000)hits.clear();
 try{
  if(cache&&now-cache.at<60000)return respond(cache.body);
  if(!inFlight)inFlight=(async()=>{
   const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
   const {data,error}=await db.rpc("tv_stats_snapshot");
   if(error)throw error;
   if(!data||data.version!==1||data.personal_data!==false)throw Error("Invalid snapshot");
   const body=JSON.stringify({ok:true,...data});
   cache={at:Date.now(),body};return body;
  })();
  return respond(await inFlight);
 }catch(e){
  console.error("tv-stats",e);
  if(cache)return respond(JSON.stringify({...JSON.parse(cache.body),stale:true}));
  return respond('{"ok":false,"error":"statistics_temporarily_unavailable"}',503);
 }finally{inFlight=null}
});