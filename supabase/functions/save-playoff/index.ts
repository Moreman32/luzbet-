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
    const body = await req.json();
    const rawCode = String(body.code || "").trim();

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

    const { data: participants, error: participantError } = await supabase
      .from("participants")
      .select("code,name")
      .ilike("code", rawCode)
      .limit(1);

    if (participantError) throw participantError;
    if (!participants || !participants.length) {
      return Response.json(
        { ok: false, error: "Код не найден" },
        { headers: corsHeaders, status: 404 }
      );
    }

    const participant = participants[0];

    const data = { ...body };
    delete data.code;
    delete data.action;
    delete data.name;

    data.code = participant.code;
    data.name = participant.name;
    data.timestamp = new Date().toISOString();

    const payload = {
      code: participant.code,
      name: participant.name,
      data,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("playoff")
      .upsert(payload, { onConflict: "code" });

    if (error) throw error;

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message || "save-playoff failed" },
      { headers: corsHeaders, status: 500 }
    );
  }
});