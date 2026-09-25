import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    return json(req, { ok: true });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "admin-auth failed" },
      500,
    );
  }
});
