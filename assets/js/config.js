// Public configuration. The publishable key is designed to be public; all authority lives in the database.
const override = (typeof window !== "undefined" && window.__LUZBET_CONFIG) || {};
export const SUPABASE_URL = override.url || "https://kdsowktuirtkxnmtyoaz.supabase.co";
export const SUPABASE_KEY = override.key || "sb_publishable_zjMkZslnb71eXQ_q6FQIAQ_eGyoW82B";
export const CURRENCY = "ЛК";
