import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured=Boolean(url&&key&&!key.includes('REPLACE_ME'));
export const supabase=configured?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}}):null;
