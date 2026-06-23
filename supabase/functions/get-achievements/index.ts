import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 2048 });
  if (blocked) return blocked;

  try {
    const { code } = await req.json();
    const rawCode = String(code || "").trim();

    if (!rawCode) {
      return json(req, { ok: false, error: "Не передан code" }, 400);
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

    return json(
      req,
      {
        ok: true,
        achievements: (data || []).map((x) => x.achievement),
      },
    );
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "get-achievements failed" },
      500,
    );
  }
});
