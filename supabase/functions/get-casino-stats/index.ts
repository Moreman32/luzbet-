import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCasinoEvents, summarizeCasinoEvents } from "../_shared/casino-ledger.ts";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 2048 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(30, parseInt(body.days ?? 7) || 7));
    const code = String(body.code || "").trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const events = await fetchCasinoEvents(supabase, {
      since: since.toISOString(),
      code: code || undefined,
    });
    const stats = summarizeCasinoEvents(events, {
      days,
      timeZone: "Europe/Moscow",
    });

    return json(
      req,
      {
        ok: true,
        ...stats,
      },
    );
  } catch (e) {
    return json(
      req,
      {
        ok: false,
        error: e instanceof Error ? e.message : "get-casino-stats failed",
      },
      500,
    );
  }
});
