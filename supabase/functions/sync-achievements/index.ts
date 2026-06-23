import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 8192 });
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const rawCode = String(body.code || "").trim();

    if (!rawCode) {
      return json(req, { ok: false, error: "Не передан code" }, 400);
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
      return json(req, { ok: false, error: "Код не найден" }, 404);
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

    return json(req, { ok: true });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "sync-achievements failed" },
      500,
    );
  }
});
