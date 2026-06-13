import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    const rawCode = String(code || "").trim();

    if (!rawCode) {
      return new Response(JSON.stringify({ ok: false, error: "Пустой код" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("predictions")
      .select("code,name,data,updated_at,id")
      .ilike("code", rawCode)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    if (!data || !data.length) {
      return new Response(JSON.stringify({ ok: false, error: "Прогноз не найден" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const row = data[0];

    return new Response(JSON.stringify({
      ok: true,
      prediction: {
        code: row.code,
        name: row.name,
        ...(row.data || {}),
      },
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});