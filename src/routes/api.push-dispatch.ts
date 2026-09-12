import { createFileRoute } from "@tanstack/react-router";

import { backendErrorResponse, backendJson, backendRequestId } from "@/lib/backend-contract";
import { createFixedWindowRequestLimiter } from "@/lib/analysis-worker-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limitPushDispatch = createFixedWindowRequestLimiter({ limit: 12, windowMs: 60_000 });

export const Route = createFileRoute("/api/push-dispatch")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Method Not Allowed" } }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }),
      POST: async ({ request }) => {
        const requestId = backendRequestId();
        const limited = limitPushDispatch(request);
        if (limited) return limited;
        const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
        const token = match?.[1] ?? "";
        if (!UUID_RE.test(token)) return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Solicitação não autorizada." }, requestId }, { status: 403, headers: { "Cache-Control": "no-store" } });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: allowed, error: authError } = await db.rpc("validate_push_dispatch_token", { p_token: token });
          if (authError || allowed !== true) return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Solicitação não autorizada." }, requestId }, { status: 403, headers: { "Cache-Control": "no-store" } });

          const { data: events, error: claimError } = await db.rpc("claim_push_delivery_batch", { p_limit: 5 });
          if (claimError) throw claimError;
          const { deliverAnalysisReadyPush } = await import("@/lib/push.server");
          let sent = 0;
          let retried = 0;
          let dead = 0;

          for (const event of events ?? []) {
            const result = await deliverAnalysisReadyPush(event.user_id, event.delivery_state);
            sent += result.sent;
            if (result.transientFailed > 0) {
              await db.rpc("fail_push_delivery_event", {
                p_id: event.id,
                p_lock_token: event.lock_token,
                p_error: result.lastError ?? "Falha temporária no Web Push.",
                p_retryable: true,
                p_delivery_state: result.deliveryState,
              });
              retried += 1;
            } else if (result.permanentFailed > 0) {
              await db.rpc("fail_push_delivery_event", {
                p_id: event.id,
                p_lock_token: event.lock_token,
                p_error: result.lastError ?? "Falha permanente no Web Push.",
                p_retryable: false,
                p_delivery_state: result.deliveryState,
              });
              dead += 1;
            } else {
              await db.rpc("complete_push_delivery_event", { p_id: event.id, p_lock_token: event.lock_token, p_delivery_state: result.deliveryState });
            }
          }

          return backendJson({ status: "OK" as const, claimed: events?.length ?? 0, sent, retried, dead }, undefined, requestId);
        } catch (error) {
          console.error("[Push dispatcher] failed", error);
          return backendErrorResponse(error, requestId);
        }
      },
    },
  },
});
