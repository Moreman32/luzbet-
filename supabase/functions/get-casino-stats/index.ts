import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCasinoEvents, summarizeCasinoEvents } from "../_shared/casino-ledger.ts";

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

    return Response.json(
      {
        ok: true,
        ...stats,
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "get-casino-stats failed",
      },
      { headers: corsHeaders, status: 500 }
    );
  }
});
