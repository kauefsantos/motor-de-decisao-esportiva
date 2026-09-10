import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/elo-sync")({
  server: {
    handlers: {
      // Secret seeding is intentionally not exposed over HTTP. The live Elo jobs
      // run directly inside PostgreSQL/pg_cron, so this endpoint is only a
      // protected fallback for an explicit server-side sync request.
      GET: async () =>
        Response.json(
          { error: "Method Not Allowed" },
          { status: 405, headers: { Allow: "POST" } },
        ),

      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import(
          "@/integrations/supabase/cron-auth"
        );
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        try {
          // Keep server-only modules out of the route's browser module graph.
          const { syncEloFromFiveDollar } = await import("@/lib/elo-sync.server");
          const result = await syncEloFromFiveDollar();
          return Response.json(result);
        } catch (error) {
          console.error("[Elo sync] protected sync failed", error);
          return Response.json(
            { status: "ERROR", error: "Não foi possível executar a sincronização Elo." },
            { status: 500 },
          );
        }
      },
    },
  },
});
