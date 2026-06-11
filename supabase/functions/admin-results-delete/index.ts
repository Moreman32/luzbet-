import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const groupCode = String(body?.group_code || "").trim().toUpperCase();

    if (!groupCode) {
      return json({ ok: false, error: "group_code is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("results")
      .delete()
      .eq("group_code", groupCode);

    if (error) throw error;

    return json({ ok: true });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "admin-results-delete failed" },
      500,
    );
  }
});
