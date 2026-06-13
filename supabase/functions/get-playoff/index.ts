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
      return Response.json(
        { ok: false, error: "Не передан code" },
        { headers: corsHeaders, status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("playoff")
      .select("code,name,data,updated_at,id,created_at")
      .ilike("code", rawCode)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || !data.length) {
      return Response.json(
        { ok: true, prediction: null },
        { headers: corsHeaders }
      );
    }

    const row = data[0];

    return Response.json(
      {
        ok: true,
        prediction: {
          code: row.code,
          name: row.name,
          ...(row.data || {}),
        },
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message || "get-playoff failed" },
      { headers: corsHeaders, status: 500 }
    );
  }
});