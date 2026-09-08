import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { familyForMarket } from "./engine/experimental-goal-markets";
import { BASE_GATE } from "./engine/opportunity";
import type { AsianOutcomeProbabilities, ContractType } from "./engine/types";
import { evaluateValue, type ValueInput } from "./engine/value";

const EXPERIMENTAL_STATUS = "EXPERIMENTAL_CURRENT_SEASON";

function selectionLimitForDate(isoDate: string | null): number {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

const schema = z.object({
  runId: z.string().uuid(),
  predictionId: z.string().min(1).max(180),
  odd: z.number().finite().gt(1).lt(1000),
  lineAtEntry: z.number().finite().nullable(),
});

/**
 * Promove uma oportunidade que passou todos os critérios de valor, mas ficou
 * fora da seleção automática por causa do limite diário.
 *
 * A oportunidade é reavaliada no servidor antes de entrar no ledger. Assim a
 * UI não consegue transformar uma odd sem valor em PROPOSED apenas alterando
 * o localStorage. O limite diário continua valendo para PROPOSED + OPEN; uma
 * sugestão DECLINED libera a vaga para uma alternativa qualificada.
 */
export const selectQualifiedExperimentalAlternative = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as any;

    const [{ data: prediction, error: predictionError }, { data: run, error: runError }] =
      await Promise.all([
        supabase
          .from("model_predictions")
          .select(
            "prediction_id,match_id,market,participant,side,line_raw,line_canonical,model_probability,outcome_distribution,model_status,data_status,model_version",
          )
          .eq("run_id", data.runId)
          .eq("prediction_id", data.predictionId)
          .eq("model_status", EXPERIMENTAL_STATUS)
          .single(),
        supabase.from("analysis_runs").select("target_date").eq("id", data.runId).single(),
      ]);

    if (predictionError || !prediction) {
      throw new Error("Não foi possível localizar esta oportunidade experimental.");
    }
    if (runError || !run) throw new Error("Não foi possível localizar a rodada desta análise.");

    const modelProbability = Number(prediction.model_probability ?? 0);
    const contractType: ContractType = prediction.line_canonical === null ? "BINARY" : "ASIAN";
    const valueInput: ValueInput = {
      candidateId: prediction.prediction_id,
      predictionId: prediction.prediction_id,
      contractType,
      bookmaker: "bet365_br",
      odd: data.odd,
      lineAtEntry: data.lineAtEntry,
      lineCanonical:
        prediction.line_canonical === null ? null : Number(prediction.line_canonical),
      pCons: contractType === "BINARY" ? modelProbability : null,
      outcomeDistribution:
        contractType === "ASIAN"
          ? (prediction.outcome_distribution as AsianOutcomeProbabilities | null)
          : null,
      published: modelProbability >= BASE_GATE,
      modelStatus: EXPERIMENTAL_STATUS,
      dataStatus: prediction.data_status,
    };
    const evaluation = evaluateValue(valueInput);

    if (
      evaluation.valueStatus !== "TEM_VALOR" ||
      evaluation.executionStatus !== "EXECUTAVEL" ||
      evaluation.rejectionReason !== null
    ) {
      throw new Error("Esta odd não atende mais a todos os critérios de valor e execução.");
    }

    const targetDate = run.target_date ?? null;
    const limit = selectionLimitForDate(targetDate);

    const { data: currentRows, error: rowsError } = await supabase
      .from("experimental_bet_tracking")
      .select("id,prediction_id,bet_status")
      .eq("run_id", data.runId);
    if (rowsError) throw new Error(`Não foi possível conferir as vagas da rodada: ${rowsError.message}`);

    const current = (currentRows ?? []) as Array<{
      id: string;
      prediction_id: string;
      bet_status: string;
    }>;
    const same = current.find((row) => row.prediction_id === data.predictionId);
    if (same?.bet_status === "OPEN" || same?.bet_status === "PROPOSED") {
      return { status: "ALREADY_SELECTED" as const, selectionLimit: limit };
    }

    const activeCount = current.filter(
      (row) => row.bet_status === "OPEN" || row.bet_status === "PROPOSED",
    ).length;
    if (activeCount >= limit) {
      throw new Error(
        `O limite desta rodada é ${limit}. Recuse uma sugestão pendente antes de selecionar outra oportunidade.`,
      );
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id,raw_partida,home_team,away_team,competition")
      .eq("id", prediction.match_id)
      .single();
    if (matchError || !match) throw new Error("Não foi possível localizar a partida desta oportunidade.");

    const matchLabel = match.home_team && match.away_team
      ? `${match.home_team} x ${match.away_team}`
      : match.raw_partida;
    const marketLabel = (() => {
      const line = prediction.line_raw ?? "";
      if (prediction.market === "corners_match_total")
        return `Escanteios da partida ${prediction.side === "UNDER" ? "Menos de" : "Mais de"} ${line}`.trim();
      if (prediction.market === "corners_team_total")
        return `Escanteios ${prediction.participant ?? "time"} ${prediction.side === "UNDER" ? "Menos de" : "Mais de"} ${line}`.trim();
      if (prediction.market === "goals_match_total")
        return `Gols da partida ${prediction.side === "UNDER" ? "Menos de" : "Mais de"} ${line}`.trim();
      if (prediction.market === "team_goals_total")
        return `Gols ${prediction.participant ?? "time"} ${prediction.side === "UNDER" ? "Menos de" : "Mais de"} ${line}`.trim();
      if (prediction.market === "1x2")
        return prediction.side === "HOME" ? "Vitória mandante" : prediction.side === "AWAY" ? "Vitória visitante" : "Empate";
      if (prediction.market === "double_chance")
        return prediction.side === "1X" ? "Dupla chance: 1X" : prediction.side === "X2" ? "Dupla chance: X2" : "Dupla chance: 12";
      if (prediction.market === "btts") return prediction.side === "YES" ? "Ambas marcam: Sim" : "Ambas marcam: Não";
      return prediction.market;
    })();

    const row = {
      run_id: data.runId,
      match_id: prediction.match_id,
      prediction_id: prediction.prediction_id,
      target_date: targetDate,
      match_label: matchLabel,
      competition: match.competition ?? null,
      market_family: familyForMarket(prediction.market),
      market: prediction.market,
      market_label: marketLabel,
      participant: prediction.participant,
      side: prediction.side,
      line_canonical:
        prediction.line_canonical === null ? null : Number(prediction.line_canonical),
      model_version: prediction.model_version ?? "unknown",
      model_status: EXPERIMENTAL_STATUS,
      model_probability: modelProbability,
      fair_odd: evaluation.fairOdd,
      entry_odd: data.odd,
      min_odd_target: evaluation.minOddTarget,
      edge: evaluation.edgeCons,
      expected_value: evaluation.evCons,
      result: "PENDING",
      bet_status: "PROPOSED",
      stake_brl: null,
      accepted_at: null,
      declined_at: null,
      notes: "MANUAL_QUALIFIED_ALTERNATIVE",
      selection_rank: null,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("experimental_bet_tracking")
      .upsert([row], { onConflict: "run_id,prediction_id" });
    if (upsertError) {
      throw new Error(`Não foi possível selecionar esta oportunidade: ${upsertError.message}`);
    }

    return {
      status: "SELECTED" as const,
      selectionLimit: limit,
      activeAfter: activeCount + 1,
      remainingSlots: Math.max(0, limit - activeCount - 1),
    };
  });
