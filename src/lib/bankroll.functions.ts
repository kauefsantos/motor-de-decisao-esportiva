import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb, type AdminDb } from "./admin-db";
import { captureClosingClv } from "./application/bankroll/capture-clv.server";
import { BackendError } from "./backend-contract";
import {
  bankrollNumber,
  buildStakeSuggestion,
  floorCents,
  operationalMaxStake,
  type BankrollTrackingRow,
} from "./domain/bankroll";
import {
  confirmBetAtomic,
  loadBankrollMetrics,
  loadOpenBets,
  settleBetAtomic,
} from "./repositories/bankroll.repository.server";

async function bankrollSnapshot(db: AdminDb, userId: string) {
  const { row, error } = await loadBankrollMetrics(db, userId);
  if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível calcular a banca.", 500);
  if (!row) throw new BackendError("NOT_FOUND", "Não foi possível carregar a configuração da banca.", 404);

  const available = Math.max(0, bankrollNumber(row.available_bankroll));
  const maxStakePct = bankrollNumber(row.max_stake_pct, 0.05);
  const fractionalKelly = bankrollNumber(row.fractional_kelly, 0.25);
  const minStakeBrl = bankrollNumber(row.min_stake_brl, 0.5);
  return {
    equity: bankrollNumber(row.current_equity),
    available,
    locked: bankrollNumber(row.locked_stake),
    maxStakePct,
    fractionalKelly,
    minStakeBrl,
    maxAllowedStake: operationalMaxStake(available, maxStakePct, minStakeBrl),
  };
}

const planSchema = z.object({ runId: z.string().uuid() });

export const getExperimentalBetPlan = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => planSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { assertRunOwner } = await import("./authorization.server");
    await assertRunOwner(db, userId, data.runId);
    const snapshot = await bankrollSnapshot(db, userId);
    const { data: rows, error } = await db
      .from("experimental_bet_tracking")
      .select("id,run_id,prediction_id,target_date,match_label,competition,market_family,market_label,model_status,model_probability,entry_odd,expected_value,edge,stake_brl,profit_brl,result,bet_status,selection_rank,accepted_at")
      .eq("run_id", data.runId)
      .order("selection_rank", { ascending: true, nullsFirst: false })
      .order("expected_value", { ascending: false });
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as seleções.", 500);

    const all = (rows ?? []) as BankrollTrackingRow[];
    const proposed = all.filter((row) => row.bet_status === "PROPOSED");
    const open = all.filter((row) => row.bet_status === "OPEN");
    const declined = all.filter((row) => row.bet_status === "DECLINED");
    const next = proposed[0] ?? null;
    const stakePlan = next
      ? buildStakeSuggestion(
          next,
          snapshot.available,
          snapshot.maxStakePct,
          snapshot.fractionalKelly,
          snapshot.minStakeBrl,
        )
      : null;

    return {
      bankroll: snapshot,
      nextProposal: next && stakePlan ? { ...next, ...stakePlan } : null,
      proposedCount: proposed.length,
      openCount: open.length,
      declinedCount: declined.length,
      all,
    };
  });

const confirmSchema = z.object({
  id: z.string().uuid(),
  stakeBrl: z.number().finite().min(0).max(1_000_000),
});

export const confirmExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => confirmSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { assertTrackingOwner } = await import("./authorization.server");
    await assertTrackingOwner(db, userId, data.id);
    const { row, error } = await confirmBetAtomic(db, data.id, floorCents(data.stakeBrl));
    if (error) throw new BackendError("CONFLICT", error.message, 409);
    if (!row) throw new BackendError("INTERNAL_ERROR", "A confirmação da banca não retornou resultado.", 500);

    return {
      status: String(row.status) === "DECLINED" ? ("DECLINED" as const) : ("OPEN" as const),
      stakeBrl: bankrollNumber(row.stake_brl),
      availableAfter: bankrollNumber(row.available_after),
      maxAllowed: bankrollNumber(row.max_allowed),
      minimumStake: bankrollNumber(row.minimum_stake, 0.5),
    };
  });

export const getOpenExperimentalBets = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
  const db = await adminDb();
  const [snapshot, openResult] = await Promise.all([
    bankrollSnapshot(db, userId),
    loadOpenBets(db, userId),
  ]);
  if (openResult.error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as apostas abertas.", 500);
  return { rows: openResult.data ?? [], bankroll: snapshot };
});

const settleSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["WIN", "LOSS"]),
});

export const settleOpenExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => settleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { assertTrackingOwner } = await import("./authorization.server");
    await assertTrackingOwner(db, userId, data.id);
    const { row, error } = await settleBetAtomic(db, data.id, data.outcome);
    if (error) throw new BackendError("CONFLICT", error.message, 409);
    if (!row) throw new BackendError("INTERNAL_ERROR", "O fechamento da aposta não retornou resultado.", 500);

    let clv = null;
    try {
      clv = await captureClosingClv(db, data.id);
    } catch (error) {
      console.warn("[CLV] Não foi possível capturar os snapshots Bet365", error);
    }

    return {
      ok: true,
      profitBrl: bankrollNumber(row.profit_brl),
      profitUnits: bankrollNumber(row.profit_units),
      clv,
    };
  });
