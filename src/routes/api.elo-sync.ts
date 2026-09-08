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
interface UntypedRpc {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
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
  const expected = (res.data as Record<string, unknown>)["bearer_token"];
  if (typeof expected !== "string" || expected.length !== token.length) return false;

  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

async function seedEloSourceSecret() {
  const key = process.env["FIVE_DOLLAR_FOOTBALL_API_KEY"]?.trim();
  if (!key) {
    return { ok: false as const, reason: "FIVE_DOLLAR_FOOTBALL_API_KEY não configurada no servidor." };
  }
  const client = supabaseAdmin as unknown as UntypedRpc;
  const result = await client.rpc("elo_store_5dollar_key", { p_key: key });
  if (result.error) throw new Error(`Falha ao semear segredo Elo: ${result.error.message}`);
  return { ok: true as const };
}

export const Route = createFileRoute("/api/elo-sync")({
  server: {
    handlers: {
      // Bootstrap idempotente: copia a chave já existente no backend para o Vault.
      // Não retorna nem expõe o segredo. Em preview privado, o acesso ainda passa
      // pela autenticação da própria Lovable.
      GET: async () => {
        try {
          const seeded = await seedEloSourceSecret();
          return Response.json(seeded.ok ? { status: "SEEDED" } : { status: "NOT_CONFIGURED", reason: seeded.reason }, {
            status: seeded.ok ? 200 : 503,
          });
        } catch (error) {
          return Response.json(
            { status: "ERROR", error: error instanceof Error ? error.message : "Falha ao preparar Elo." },
            { status: 500 },
          );
        }
      },
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
