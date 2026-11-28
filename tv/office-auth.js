import {SUPABASE_URL,SUPABASE_KEY} from '../assets/js/config.js?v=2.3.8';
export {SUPABASE_URL,SUPABASE_KEY};
export const officeRequested=new URLSearchParams(location.search).get('office')==='1';
export const tvAuth=officeRequested&&window.supabase?window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'luzbet2-auth'}}):null;

if(tvAuth)tvAuth.auth.onAuthStateChange((event,session)=>{if(!session||event==='SIGNED_OUT')window.dispatchEvent(new Event('tv-office-auth-lost'))});
