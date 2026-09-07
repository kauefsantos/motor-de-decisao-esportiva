import { createFileRoute } from "@tanstack/react-router";

import { syncEloFromFiveDollar } from "@/lib/elo-sync.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DbResponse = { data: unknown; error: { message: string } | null };
interface DbQuery extends PromiseLike<DbResponse> {
  select(columns?: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  single(): DbQuery;
}
interface UntypedDb {
  from(table: string): DbQuery;
}

function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

async function authorized(request: Request): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  const db = supabaseAdmin as unknown as UntypedDb;
  const res = await db
    .from("elo_cron_config")
    .select("bearer_token")
    .eq("id", "main")
    .single();
  if (res.error || !res.data || typeof res.data !== "object") return false;
  const expected = (res.data as Record<string, unknown>).bearer_token;
  if (typeof expected !== "string" || expected.length !== token.length) return false;

  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export const Route = createFileRoute("/api/elo-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        try {
          const result = await syncEloFromFiveDollar();
          return Response.json(result);
        } catch (error) {
          return Response.json(
            {
              status: "ERROR",
              error: error instanceof Error ? error.message : "Falha desconhecida no Elo sync.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
