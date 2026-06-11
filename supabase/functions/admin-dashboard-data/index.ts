import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      predictionsRes,
      resultsRes,
      casinoRes,
      achievementsRes,
    ] = await Promise.all([
      supabase
        .from("predictions")
        .select("code,name,data,updated_at,id")
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("results")
        .select("group_code,data,updated_at,id")
        .order("group_code", { ascending: true }),
      supabase
        .from("casino")
        .select("code,name,coins,spent,last_daily,last_cashback")
        .order("code", { ascending: true }),
      supabase
        .from("achievements")
        .select("code,achievement,unlocked_at,id")
        .order("id", { ascending: true }),
    ]);

    if (predictionsRes.error) throw predictionsRes.error;
    if (resultsRes.error) throw resultsRes.error;
    if (casinoRes.error) throw casinoRes.error;
    if (achievementsRes.error) throw achievementsRes.error;

    return json({
      ok: true,
      predictions: predictionsRes.data || [],
      results: resultsRes.data || [],
      casino: casinoRes.data || [],
      achievements: achievementsRes.data || [],
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "admin-dashboard-data failed" },
      500,
    );
  }
});
