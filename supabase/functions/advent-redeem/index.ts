import { createClient } from "npm:@supabase/supabase-js@2.116.0";
const cors={"Access-Control-Allow-Origin":"https://luzbet.lol","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async req=>{
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(req.method!=="POST")return json({ok:false},405);
const jwt=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];if(!jwt)return json({ok:false},401);
const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_ANON_KEY")!;
const client=createClient(url,key,{global:{headers:{Authorization:"Bearer "+jwt}},auth:{persistSession:false,autoRefreshToken:false}});
const {data:{user},error:authError}=await client.auth.getUser(jwt);if(authError||!user)return json({ok:false},401);
let day,opening;try{const b=await req.json();day=b.day;opening=b.opening===true}catch{return json({ok:false},400)}
if(typeof day!=="string"||!/^2026-12-\d{2}$/.test(day))return json({ok:false},400);
const {data:state,error}=await client.rpc(opening?"advent_2026_state":"advent_2026_redeem",{p_day:day});if(error)return json({ok:false,error:"not_available"},409); return json({ok:true,notified:false,state:opening?state:undefined});
});