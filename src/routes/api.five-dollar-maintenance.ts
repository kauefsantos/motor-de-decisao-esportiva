import { createFileRoute } from "@tanstack/react-router";

import { createFixedWindowRequestLimiter, readBoundedJsonObject } from "@/lib/analysis-worker-security";
import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { callAdminRuntimeRpc } from "@/lib/repositories/runtime-rpc.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAILY_D2_ACTION = "DAILY_D2_ANALYSIS";
const SAME_DAY_ACTION = "SAME_DAY_ANALYSIS";
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
          const action = typeof body?.["action"] === "string" ? body["action"] : null;
          const afterLocalTime = typeof body?.["afterLocalTime"] === "string" ? body["afterLocalTime"] : "";
          if (action !== null && action !== DAILY_D2_ACTION && action !== SAME_DAY_ACTION) {
            return Response.json(
              { ok: false, error: { code: "VALIDATION_ERROR", message: "Ação de automação inválida." }, requestId },
              { status: 400, headers: { "Cache-Control": "no-store" } },
            );
          }
          if (action === SAME_DAY_ACTION && !HHMM_RE.test(afterLocalTime)) {
            return Response.json(
              { ok: false, error: { code: "VALIDATION_ERROR", message: "Horário mínimo inválido." }, requestId },
              { status: 400, headers: { "Cache-Control": "no-store" } },
            );
          }
          if (!UUID_RE.test(token)) {
            return Response.json(
              { ok: false, error: { code: "FORBIDDEN", message: "Solicitação de manutenção inválida." }, requestId },
              { status: 403, headers: { "Cache-Control": "no-store" } },
            );
          }
          const { data: allowed, error } = await callAdminRuntimeRpc<boolean>(
            "validate_external_api_maintenance_token",
            { p_token: token },
          );
          if (error || allowed !== true) {
            return Response.json(
              { ok: false, error: { code: "FORBIDDEN", message: "Solicitação de manutenção não autorizada." }, requestId },
              { status: 403, headers: { "Cache-Control": "no-store" } },
            );
          }

          if (action === DAILY_D2_ACTION) {
            const { runScheduledDailyAnalysis } = await import("@/lib/scheduled-analysis.server");
            return backendJson(await runScheduledDailyAnalysis(), undefined, requestId);
          }
          if (action === SAME_DAY_ACTION) {
            const { runSameDayOnDemandAnalysis } = await import("@/lib/on-demand-analysis.server");
            return backendJson(await runSameDayOnDemandAnalysis(afterLocalTime), undefined, requestId);
          }

          const { runFiveDollarMaintenance } = await import("@/lib/five-dollar-maintenance.server");
          return backendJson(await runFiveDollarMaintenance(), undefined, requestId);
        } catch (error) {
          console.error("[FiveDollar automation] failed", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
