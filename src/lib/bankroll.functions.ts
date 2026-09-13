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
import { executionValueContract } from "./engine/execution-value";
import { evaluateValue, type RejectionReason } from "./engine/value";
import {
  confirmBetAtomic,
  loadBankrollMetrics,
  loadOpenBets,
  settleBetAtomic,
} from "./repositories/bankroll.repository.server";

const EXECUTION_QUOTE_MAX_AGE_MS = 10 * 60 * 1000;
const EXECUTION_QUOTE_FUTURE_TOLERANCE_MS = 60 * 1000;

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
      .select("id,run_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,side,line_canonical,model_status,model_probability,entry_odd,expected_value,edge,stake_brl,profit_brl,result,bet_status,selection_rank,accepted_at")
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
  currentOdd: z.number().finite().gt(1).lt(1000).nullable().optional(),
  currentLine: z.number().finite().nullable().optional(),
  currentQuoteCapturedAt: z.string().datetime().nullable().optional(),
});

function rejectionMessage(reason: RejectionReason | null) {
  if (reason === "ODD_BELOW_MINIMUM") return "A odd atual está abaixo de 1,70. Não registre a aposta.";
  if (reason === "EV_BELOW_THRESHOLD") return "Com a odd atual, o valor esperado ficou abaixo de 8%. Não registre a aposta.";
  if (reason === "EDGE_BELOW_THRESHOLD") return "Com a odd atual, a vantagem ficou abaixo de 5 p.p. Não registre a aposta.";
  if (reason === "REFORECAST_REQUIRED") return "A linha atual mudou em relação à linha modelada. É necessário recalcular a partida antes de apostar.";
  if (reason === "MODEL_PROBABILITY_BELOW_THRESHOLD") return "A probabilidade operacional ficou abaixo de 70%. Não registre a aposta.";
  return "A cotação atual não atende mais a todos os critérios da decisão. Nada foi registrado.";
}

function assertFreshExecutionQuote(capturedAt: string | null | undefined) {
  if (!capturedAt) {
    throw new BackendError("CONFLICT", "Confira novamente a cotação atual da Bet365 antes de registrar a aposta.", 409);
  }
  const observedAt = Date.parse(capturedAt);
  const now = Date.now();
  if (
    !Number.isFinite(observedAt) ||
    observedAt < now - EXECUTION_QUOTE_MAX_AGE_MS ||
    observedAt > now + EXECUTION_QUOTE_FUTURE_TOLERANCE_MS
  ) {
    throw new BackendError("CONFLICT", "A cotação confirmada ficou desatualizada. Confira novamente a odd e a linha atuais da Bet365.", 409);
  }
}

export const confirmExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => confirmSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { assertTrackingOwner } = await import("./authorization.server");
    await assertTrackingOwner(db, userId, data.id);

    if (data.stakeBrl <= 0) {
      const { row, error } = await confirmBetAtomic(db, {
        id: data.id,
        stakeBrl: 0,
        entryOdd: null,
        expectedValue: null,
        edge: null,
        lineCanonical: null,
        quoteCapturedAt: null,
      });
      if (error) throw new BackendError("CONFLICT", error.message, 409);
      if (!row) throw new BackendError("INTERNAL_ERROR", "A confirmação da banca não retornou resultado.", 500);
      return {
        status: "DECLINED" as const,
        stakeBrl: 0,
        availableAfter: bankrollNumber(row.available_after),
        maxAllowed: bankrollNumber(row.max_allowed),
        minimumStake: bankrollNumber(row.minimum_stake, 0.5),
      };
    }

    if (data.currentOdd === null || data.currentOdd === undefined) {
      throw new BackendError("CONFLICT", "Confira a odd atual na Bet365 antes de registrar a aposta.", 409);
    }
    assertFreshExecutionQuote(data.currentQuoteCapturedAt);

    const { data: tracking, error: trackingError } = await db
      .from("experimental_bet_tracking")
      .select("id,run_id,prediction_id,market,side,line_canonical,model_status,model_probability,bet_status")
      .eq("id", data.id)
      .single();
    if (trackingError || !tracking) {
      throw new BackendError("NOT_FOUND", "Não foi possível localizar esta sugestão.", 404);
    }
    if (tracking.bet_status !== "PROPOSED") {
      throw new BackendError("CONFLICT", "Esta sugestão já foi confirmada ou recusada.", 409);
    }

    const { data: prediction, error: predictionError } = await db
      .from("model_predictions")
      .select("prediction_id,market,side,line_canonical,p_cal,conservative_probability,outcome_distribution,model_status,data_status,calibration_version")
      .eq("run_id", tracking.run_id)
      .eq("prediction_id", tracking.prediction_id)
      .single();
    if (predictionError || !prediction) {
      throw new BackendError("CONFLICT", "A previsão que originou esta escolha não está mais disponível.", 409);
    }

    const lineCanonical = prediction.line_canonical === null ? null : Number(prediction.line_canonical);
    if (
      prediction.market !== tracking.market ||
      prediction.side !== tracking.side ||
      lineCanonical !== (tracking.line_canonical === null ? null : Number(tracking.line_canonical))
    ) {
      throw new BackendError("CONFLICT", "O contrato da previsão mudou. Refaça a análise antes de registrar a aposta.", 409);
    }
    if (
      prediction.model_status !== "PRODUCTION_VALIDATED" ||
      prediction.data_status !== "OK" ||
      prediction.calibration_version === null
    ) {
      throw new BackendError("CONFLICT", "A previsão não possui validação e calibração de produção vigentes.", 409);
    }

    const probabilityRaw = prediction.conservative_probability ?? prediction.p_cal;
    const probability = probabilityRaw === null ? null : Number(probabilityRaw);
    if (probability === null || !Number.isFinite(probability)) {
      throw new BackendError("CONFLICT", "A probabilidade operacional não está disponível para revalidar a aposta.", 409);
    }

    if (lineCanonical !== null && (data.currentLine === null || data.currentLine === undefined)) {
      throw new BackendError("CONFLICT", "Confira também a linha atual da Bet365 antes de registrar a aposta.", 409);
    }
    if (lineCanonical === null && data.currentLine !== null && data.currentLine !== undefined) {
      throw new BackendError("CONFLICT", "Esta aposta não usa linha numérica. Revise a cotação informada.", 409);
    }

    const contract = executionValueContract({
      market: prediction.market,
      side: prediction.side,
      lineCanonical,
      storedOutcomeDistribution: prediction.outcome_distribution,
    });
    const evaluation = evaluateValue({
      candidateId: tracking.prediction_id,
      predictionId: tracking.prediction_id,
      contractType: contract.contractType,
      bookmaker: "bet365_br",
      odd: data.currentOdd,
      lineAtEntry: data.currentLine ?? null,
      lineCanonical,
      pCons: probability,
      outcomeDistribution: contract.outcomeDistribution,
      published: true,
      modelStatus: prediction.model_status,
      dataStatus: prediction.data_status,
    });

    if (
      evaluation.executionStatus !== "EXECUTAVEL" ||
      evaluation.evCons === null ||
      evaluation.edgeCons === null
    ) {
      throw new BackendError("CONFLICT", rejectionMessage(evaluation.rejectionReason), 409);
    }

    const { row, error } = await confirmBetAtomic(db, {
      id: data.id,
      stakeBrl: floorCents(data.stakeBrl),
      entryOdd: data.currentOdd,
      expectedValue: evaluation.evCons,
      edge: evaluation.edgeCons,
      lineCanonical,
      quoteCapturedAt: data.currentQuoteCapturedAt ?? null,
    });
    if (error) throw new BackendError("CONFLICT", error.message, 409);
    if (!row) throw new BackendError("INTERNAL_ERROR", "A confirmação da banca não retornou resultado.", 500);

    return {
      status: String(row.status) === "DECLINED" ? ("DECLINED" as const) : ("OPEN" as const),
      stakeBrl: bankrollNumber(row.stake_brl),
      availableAfter: bankrollNumber(row.available_after),
      maxAllowed: bankrollNumber(row.max_allowed),
      minimumStake: bankrollNumber(row.minimum_stake, 0.5),
      executionOdd: data.currentOdd,
      executionExpectedValue: evaluation.evCons,
      executionEdge: evaluation.edgeCons,
      executionQuoteCapturedAt: data.currentQuoteCapturedAt,
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
  outcome: z.enum(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS", "VOID"]),
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