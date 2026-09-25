import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 4096 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
      : [];

    if (!code) {
      return json(req, { ok: false, error: "code is required" }, 400);
    }

    if (!ids.length) {
      return json(req, { ok: true, updated: 0 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("match_rewards")
      .update({ shown_at: new Date().toISOString() })
      .eq("code", code)
      .in("id", ids);

    if (error) throw error;

    return json(req, {
      ok: true,
      updated: ids.length,
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "mark-match-rewards-shown failed" },
      500,
    );
  }
});
