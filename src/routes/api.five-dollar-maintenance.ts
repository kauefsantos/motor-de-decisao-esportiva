import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limitMaintenance = createFixedWindowRequestLimiter({ limit: 6, windowMs: 60_000 });

export const Route = createFileRoute("/api/five-dollar-maintenance")({
  server: {
    handlers: {
      GET: async () => {
        const requestId = backendRequestId();
        return Response.json(
          { ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" }, requestId },
          { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const limited = limitMaintenance(request);
        if (limited) return limited;
        try {
          const body = await readBoundedJsonObject(request);
          const token = typeof body?.["dispatchToken"] === "string" ? body["dispatchToken"] : "";
          if (!UUID_RE.test(token)) {
            return Response.json(
              { ok: false, error: { code: "FORBIDDEN", message: "Solicitação de manutenção inválida." }, requestId },
              { status: 403, headers: { "Cache-Control": "no-store" } },
            );
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: allowed, error } = await (supabaseAdmin as any).rpc("validate_external_api_maintenance_token", { p_token: token });
          if (error || allowed !== true) {
            return Response.json(
              { ok: false, error: { code: "FORBIDDEN", message: "Solicitação de manutenção não autorizada." }, requestId },
              { status: 403, headers: { "Cache-Control": "no-store" } },
            );
          }
          const { runFiveDollarMaintenance } = await import("@/lib/five-dollar-maintenance.server");
          return backendJson(await runFiveDollarMaintenance(), undefined, requestId);
        } catch (error) {
          console.error("[FiveDollar maintenance] failed", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
