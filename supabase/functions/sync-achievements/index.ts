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
      return Response.json({ ok: false, error: "Не передан code" }, { headers: corsHeaders, status: 400 });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids
      : JSON.parse(body.ids || "[]");

    const cleanIds = [...new Set(
      ids
        .map((x: unknown) => String(x || "").trim())
        .filter(Boolean)
    )];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: participants, error: participantError } = await supabase
      .from("participants")
      .select("code")
      .ilike("code", rawCode)
      .limit(1);

    if (participantError) throw participantError;
    if (!participants || !participants.length) {
      return Response.json({ ok: false, error: "Код не найден" }, { headers: corsHeaders, status: 404 });
    }

    const canonicalCode = participants[0].code;

    const { error: deleteError } = await supabase
      .from("achievements")
      .delete()
      .ilike("code", canonicalCode);

    if (deleteError) throw deleteError;

    if (cleanIds.length) {
      const rows = cleanIds.map((achievement) => ({
        code: canonicalCode,
        achievement,
      }));

      const { error: insertError } = await supabase
        .from("achievements")
        .insert(rows);

      if (insertError) throw insertError;
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message || "sync-achievements failed" },
      { headers: corsHeaders, status: 500 }
    );
  }
});