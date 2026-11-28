import {createClient} from "npm:@supabase/supabase-js@2.116.0";
Deno.serve(async req=>{
 const origin=req.headers.get("Origin")||"";
 const headers={"Access-Control-Allow-Origin":origin==="https://www.luzbet.lol"?origin:"https://luzbet.lol","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,OPTIONS","Cache-Control":"no-store","Content-Type":"application/json","Vary":"Origin"};
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
 if(req.method==="OPTIONS")return json({});
 if(req.method!=="GET")return json({error:"method"},405);
 const token=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return json({error:"unauthorized"},401);
 const svc=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await svc.auth.getUser(token);
 if(error||!data.user)return json({error:"unauthorized"},401);
 const result=await svc.rpc("tv_office_replays",{p_viewer:data.user.id});
 if(result.error)return json({error:"unavailable"},503);
 if(result.data===null)return json({error:"forbidden"},403);
 return json({version:1,replays:result.data});
});