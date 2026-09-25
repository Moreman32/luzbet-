import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 16384 });
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const rawCode = String(body.code || "").trim();

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
      return json(req, { ok: false, error: error.message }, 500);
    }

    return json(req, { ok: true });
  } catch (e) {
    return json(req, {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }, 500);
  }
});
