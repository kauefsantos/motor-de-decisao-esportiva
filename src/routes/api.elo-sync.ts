import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";

export const Route = createFileRoute("/api/elo-sync")({
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
        const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
        const denied = await authenticateCronRequest(request);
        if (denied) {
          return Response.json(
            { ok: false, error: { code: "FORBIDDEN", message: "Solicitação não autorizada." }, requestId },
            { status: denied.status, headers: { "Cache-Control": "no-store" } },
          );
        }
        try {
          const { syncEloFromFiveDollar } = await import("@/lib/elo-sync.server");
          return backendJson(await syncEloFromFiveDollar(), undefined, requestId);
        } catch (error) {
          console.error("[Elo sync] protected sync failed", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
