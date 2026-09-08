import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { BASE_GATE } from "./engine/opportunity";
import { evaluateValue, type ValueInput } from "./engine/value";
import type { AsianOutcomeProbabilities, ContractType } from "./engine/types";
import { familyForMarket } from "./engine/experimental-goal-markets";
import { EXPERIMENTAL_MARKETS_STATUS } from "./experimental-markets-run.functions";

const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;

function selectionLimitForDate(isoDate: string | null): number {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

function labelFor(
  market: string,
  participant: string | null,
  side: string | null,
  lineRaw: string | null,
) {
  if (market === "corners_match_total") {
    return `Escanteios da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "corners_team_total") {
    return `Escanteios ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "goals_match_total") {
    return `Gols da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "team_goals_total") {
    return `Gols ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "1x2") {
    return side === "HOME" ? "Vitória mandante" : side === "AWAY" ? "Vitória visitante" : "Empate";
  }
  if (market === "double_chance") {
    return side === "1X" ? "Dupla chance: 1X" : side === "X2" ? "Dupla chance: X2" : "Dupla chance: 12";
  }
  if (market === "btts") return side === "YES" ? "Ambas marcam: Sim" : "Ambas marcam: Não";
  return market;
}

const promoteSchema = z.object({
  runId: z.string().uuid(),
  predictionId: z.string().min(1).max(180),
  odd: z.number().finite().gt(1).lt(1000),
  lineAtEntry: z.number().finite().nullable(),
});

export const promoteQualifiedExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => promoteSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as any;

    const [{ data: prediction, error: predictionError }, { data: run, error: runError }] = await Promise.all([
      supabase
        .from("model_predictions")
        .select(
          "prediction_id,match_id,market,participant,side,line_raw,line_canonical,model_probability,outcome_distribution,model_version,model_status,data_status",
        )
        .eq("run_id", data.runId)
        .eq("prediction_id", data.predictionId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS)
        .single(),
      supabase
        .from("analysis_runs")
        .select("target_date")
        .eq("id", data.runId)
        .single(),
    ]);

    if (predictionError || !prediction) {
      throw new Error("Não foi possível localizar esta oportunidade experimental.");
    }
    if (runError || !run) {
      throw new Error("Não foi possível localizar a rodada desta oportunidade.");
    }

    const { data: existing } = await supabase
      .from("experimental_bet_tracking")
      .select("id,bet_status")
      .eq("run_id", data.runId)
      .eq("prediction_id", data.predictionId)
      .maybeSingle();

    if (existing) {
      if (existing.bet_status === "PROPOSED" || existing.bet_status === "OPEN") {
        return { ok: true, alreadySelected: true, trackingId: existing.id };
      }
      throw new Error(
        existing.bet_status === "DECLINED"
          ? "Esta oportunidade já foi recusada nesta rodada."
          : "Esta oportunidade já foi encerrada nesta rodada.",
      );
    }

    const modelProbability = Number(prediction.model_probability ?? 0);
    if (!(modelProbability >= BASE_GATE)) {
      throw new Error("Esta oportunidade não passou pelo gate mínimo do Motor 1.");
    }

    const contractType: ContractType = prediction.line_canonical === null ? "BINARY" : "ASIAN";
    const valueInput: ValueInput = {
      candidateId: prediction.prediction_id,
      predictionId: prediction.prediction_id,
      contractType,
      bookmaker: "bet365_br",
      odd: data.odd,
      lineAtEntry: data.lineAtEntry,
      lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
      pCons: contractType === "BINARY" ? modelProbability : null,
      outcomeDistribution:
        contractType === "ASIAN"
          ? (prediction.outcome_distribution as AsianOutcomeProbabilities | null)
          : null,
      published: modelProbability >= BASE_GATE,
      modelStatus: prediction.model_status,
      dataStatus: prediction.data_status,
    };
    const evaluated = evaluateValue(valueInput);
    if (evaluated.valueStatus !== "TEM_VALOR" || evaluated.executionStatus !== "EXECUTAVEL") {
      throw new Error("Esta odd não atende mais aos critérios mínimos de valor e execução.");
    }

    const selectionLimit = selectionLimitForDate(run.target_date ?? null);
    const { data: activeRows, error: activeError } = await supabase
      .from("experimental_bet_tracking")
      .select("id")
      .eq("run_id", data.runId)
      .in("bet_status", ["PROPOSED", "OPEN", "SETTLED"]);
    if (activeError) throw new Error(`Não foi possível conferir as vagas da rodada: ${activeError.message}`);

    const active = activeRows ?? [];
    if (active.length >= selectionLimit) {
      throw new Error(
        `O limite desta rodada é de ${selectionLimit} seleção(ões). Recuse uma sugestão pendente antes de escolher outra.`,
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
    const now = new Date().toISOString();

    const row = {
      run_id: data.runId,
      match_id: prediction.match_id,
      prediction_id: prediction.prediction_id,
      target_date: run.target_date,
      match_label: matchLabel,
      competition: match.competition ?? null,
      market_family: familyForMarket(prediction.market),
      market: prediction.market,
      market_label: labelFor(
        prediction.market,
        prediction.participant,
        prediction.side,
        prediction.line_raw,
      ),
      participant: prediction.participant,
      side: prediction.side,
      line_canonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
      model_version: prediction.model_version ?? "unknown",
      model_status: EXPERIMENTAL_MARKETS_STATUS,
      model_probability: modelProbability,
      fair_odd: evaluated.fairOdd,
      entry_odd: evaluated.odd,
      min_odd_target: evaluated.minOddTarget,
      edge: evaluated.edgeCons,
      expected_value: evaluated.evCons,
      result: "PENDING",
      bet_status: "PROPOSED",
      selection_rank: null,
      notes: "Selecionada manualmente entre oportunidades qualificadas fora da seleção final automática.",
      updated_at: now,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("experimental_bet_tracking")
      .insert(row)
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`Não foi possível adicionar esta oportunidade à confirmação: ${insertError?.message ?? "erro desconhecido"}`);
    }

    return {
      ok: true,
      alreadySelected: false,
      trackingId: inserted.id,
      selectionLimit,
      productionStatus: PRODUCTION_STATUS,
    };
  });
