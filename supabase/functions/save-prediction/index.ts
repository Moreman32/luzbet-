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
    const body = await req.json();
    const rawCode = String(body.code || "").trim();

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

    const { data: participants, error: participantError } = await supabase
      .from("participants")
      .select("code,name")
      .ilike("code", rawCode)
      .limit(1);

    if (participantError) {
      return new Response(JSON.stringify({ ok: false, error: participantError.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const participant = participants?.[0];
    if (!participant) {
      return new Response(JSON.stringify({ ok: false, error: "Код не найден" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key !== "code" && key !== "action" && key !== "name") {
        data[key] = value;
      }
    }

    const payload = {
      code: participant.code,
      name: participant.name,
      data,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("predictions")
      .upsert(payload, { onConflict: "code" });

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
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
