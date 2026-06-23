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

    const { data, error } = await supabase
      .from("predictions")
      .select("code,name,data,updated_at,id")
      .ilike("code", rawCode)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (error) {
      return json(req, { ok: false, error: error.message }, 500);
    }

    if (!data || !data.length) {
      return json(req, { ok: false, error: "Прогноз не найден" }, 404);
    }

    const row = data[0];

    return json(req, {
      ok: true,
      prediction: {
        code: row.code,
        name: row.name,
        ...(row.data || {}),
      },
    });
  } catch (e) {
    return json(req, {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }, 500);
  }
});
