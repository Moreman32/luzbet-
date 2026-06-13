import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    const rawCode = String(code || "").trim();

    if (!rawCode) {
      return Response.json({ ok: false, error: "Не передан code" }, { headers: corsHeaders, status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("achievements")
      .select("achievement")
      .ilike("code", rawCode);

    if (error) throw error;

    return Response.json(
      {
        ok: true,
        achievements: (data || []).map((x) => x.achievement),
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message || "get-achievements failed" },
      { headers: corsHeaders, status: 500 }
    );
  }
});