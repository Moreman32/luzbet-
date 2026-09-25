import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 2048 });
  if (blocked) return blocked;

  try {
    const { code } = await req.json();

    const rawCode = String(code || "").trim();
    if (!rawCode) {
      return json(req, { ok: false, error: "Пустой код" }, 400);
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
      return json(req, { ok: false, error: participantError.message }, 500);
    }

    const participant = participants?.[0];
    if (!participant) {
      return json(req, { ok: false, error: "Код не найден" }, 404);
    }

    const { count, error: predictionError } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true })
      .ilike("code", participant.code);

    if (predictionError) {
      return json(req, { ok: false, error: predictionError.message }, 500);
    }

    return json(req, {
      ok: true,
      code: participant.code,
      name: participant.name,
      hasVoted: (count || 0) > 0,
    });
  } catch (e) {
    return json(req, {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }, 500);
  }
});
