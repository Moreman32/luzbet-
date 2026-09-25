import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("results")
      .select("group_code,data,updated_at,id")
      .order("group_code", { ascending: true });

    if (error) throw error;

    return json(req, {
      ok: true,
      rows: data || [],
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "admin-results-list failed" },
      500,
    );
  }
});
