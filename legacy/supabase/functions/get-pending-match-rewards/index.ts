import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 2048 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();

    if (!code) {
      return json(req, { ok: false, error: "code is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("match_rewards")
      .select("id,code,match_key,group_code,match_index,pred_home,pred_away,actual_home,actual_away,result_type,coins_delta,message,settled_at,shown_at")
      .eq("code", code)
      .is("shown_at", null)
      .order("settled_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;

    return json(req, {
      ok: true,
      rewards: data || [],
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "get-pending-match-rewards failed" },
      500,
    );
  }
});
