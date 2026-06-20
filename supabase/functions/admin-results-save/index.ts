import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";
import { settleGroupRewards } from "../_shared/match-rewards.ts";

function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizePayload(item)]),
    );
  }
  return String(value ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const groupCode = String(body?.group_code || "").trim().toUpperCase();
    const data = body?.data && typeof body.data === "object" ? body.data : null;

    if (!groupCode) {
      return json({ ok: false, error: "group_code is required" }, 400);
    }

    if (!data) {
      return json({ ok: false, error: "data is required" }, 400);
    }

    const payload = sanitizePayload(data);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: saved, error } = await supabase
      .from("results")
      .upsert(
        {
          group_code: groupCode,
          data: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "group_code" },
      )
      .select("group_code,data,updated_at,id")
      .single();

    if (error) throw error;

    const settlement = groupCode.startsWith("_")
      ? { skipped: true, reason: "system result row" }
      : await settleGroupRewards(supabase, groupCode);

    return json({
      ok: true,
      row: saved,
      settlement,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "admin-results-save failed" },
      500,
    );
  }
});
