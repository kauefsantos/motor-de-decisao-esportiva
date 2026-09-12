import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb, type AdminDb } from "./admin-db";
import { captureClosingClv } from "./application/bankroll/capture-clv.server";
import { BackendError } from "./backend-contract";
import {
  calculateExperimentalAnalytics,
  CURRENT_DECISION_POLICY,
  RESULT_VALUES,
  toNumber,
  type BetStatus,
} from "./domain/analytics";
import { loadAnalyticsConfig, loadTrackingHistory } from "./repositories/analytics.repository.server";
import { callRuntimeRpc } from "./repositories/runtime-rpc.server";

async function retryDueClv(db: AdminDb, userId: string) {
  const { data, error } = await callRuntimeRpc<Array<{ id: string }>>(db, "get_due_clv_tracking_ids", {
    p_owner_id: userId,
    p_limit: 2,
  });
  if (error) return;
  for (const row of data ?? []) {
    try {
      await captureClosingClv(db, row.id);
    } catch (captureError) {
      console.warn("[CLV] retry indisponível", captureError);
    }
  }
}

export const getExperimentalAnalytics = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
  const db = await adminDb();

  const { data: config, error: configError } = await loadAnalyticsConfig(db, userId);
  if (configError || !config) {
    throw new BackendError("INTERNAL_ERROR", "Falha ao carregar configuração do acompanhamento.", 500);
  }

  await retryDueClv(db, userId);
  const { data: allRows, error: trackingError } = await loadTrackingHistory(db, userId);
  if (trackingError) {
    throw new BackendError("INTERNAL_ERROR", "Falha ao carregar histórico experimental.", 500);
  }

  const inConfiguredPeriod = allRows.filter(
    (row) => typeof row.target_date === "string" && row.target_date >= config.start_date,
  );
  const legacyRows = inConfiguredPeriod.filter(
    (row) => row.decision_policy_version !== CURRENT_DECISION_POLICY,
  );
  const rows = inConfiguredPeriod.filter(
    (row) =>
      row.decision_policy_version === CURRENT_DECISION_POLICY &&
      (row.bet_status === "OPEN" || row.bet_status === "SETTLED" || row.result !== "PENDING" || toNumber(row.stake_brl) > 0),
  );

  return {
    rows,
    policyVersion: CURRENT_DECISION_POLICY,
    legacy: {
      rows: legacyRows,
      count: legacyRows.length,
      decided: legacyRows.filter((row) => row.result === "WIN" || row.result === "LOSS").length,
      note: "Legado preservado para rastreabilidade e excluído dos indicadores da política atual.",
    },
    ...calculateExperimentalAnalytics(rows, config),
  };
});

const settleSchema = z.object({
  id: z.string().uuid(),
  result: z.enum(RESULT_VALUES),
  stakeBrl: z.number().finite().min(0).max(1_000_000).nullable(),
  closingOdd: z.number().finite().gt(1).lt(1000).nullable(),
  notes: z.string().max(500).nullable().optional(),
});

export const updateExperimentalTracking = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => settleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { assertTrackingOwner } = await import("./authorization.server");
    await assertTrackingOwner(db, userId, data.id);

    const { data: row, error: fetchError } = await db
      .from("experimental_bet_tracking")
      .select("id,entry_odd,bet_status")
      .eq("id", data.id)
      .single();
    if (fetchError || !row) {
      throw new BackendError("NOT_FOUND", "Não foi possível localizar a seleção.", 404);
    }

    const stake = data.stakeBrl ?? null;
    let profitBrl: number | null = null;
    let profitUnits: number | null = null;
    let settledAt: string | null = null;
    let betStatus: BetStatus = row.bet_status as BetStatus;
    if (data.result !== "PENDING") {
      if (stake === null || !(stake > 0)) {
        throw new BackendError("VALIDATION_ERROR", "Informe o valor realmente usado antes de fechar o resultado.", 400);
      }
      const entryOdd = toNumber(row.entry_odd);
      profitUnits = data.result === "WIN" ? entryOdd - 1 : data.result === "LOSS" ? -1 : 0;
      profitBrl = stake * profitUnits;
      settledAt = new Date().toISOString();
      betStatus = "SETTLED";
    } else if (stake !== null && stake > 0) {
      betStatus = "OPEN";
    }

    const { error } = await db
      .from("experimental_bet_tracking")
      .update({
        stake_brl: stake,
        closing_odd: data.closingOdd,
        result: data.result,
        bet_status: betStatus,
        profit_units: profitUnits,
        profit_brl: profitBrl,
        notes: data.notes ?? null,
        settled_at: settledAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new BackendError("INTERNAL_ERROR", "Falha ao atualizar o histórico.", 500);

    return { ok: true };
  });
