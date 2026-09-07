// Diagnóstico experimental do modelo de escanteios com dados REAIS da temporada atual.
// Somente leitura: não grava nada, não altera Motor 1/Motor 2 nem o pipeline.
import { createServerFn } from "@tanstack/react-start";

import {
  validateExperimentalCurrentSeason,
  type ExperimentalOutcome,
} from "./engine/corners.experimental";
import { currentSeasonRows, seasonLabel, seasonOf } from "./engine/corners.season";

export interface LineageEntry {
  source: string;
  definitionVersion: string;
  observations: number;
}

export interface ExperimentalReport {
  season: string;
  competitions: string[];
  predictionAt: string;
  lineage: LineageEntry[];
  outcome: ExperimentalOutcome;
  matches: {
    date: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    homeCorners: number;
    awayCorners: number;
  }[];
}

export const getCornersExperimentalReport = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExperimentalReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildDataset } = await import("./engine/corners.train.server");

    const predictionAt = new Date().toISOString();
    const { data } = await supabaseAdmin
      .from("raw_observations")
      .select("raw_value, source, definition_version")
      .ilike("metric", "%corners_taken")
      .limit(5000);

    const observations = (data ?? []) as {
      raw_value: Record<string, unknown> | null;
      source: string;
      definition_version: string | null;
    }[];

    const lineageMap = new Map<string, LineageEntry>();
    for (const o of observations) {
      const key = `${o.source}|${o.definition_version ?? "—"}`;
      const cur = lineageMap.get(key) ?? {
        source: o.source,
        definitionVersion: o.definition_version ?? "—",
        observations: 0,
      };
      cur.observations += 1;
      lineageMap.set(key, cur);
    }

    const all = buildDataset(observations).filter((r) => r.date < predictionAt.slice(0, 10));
    const season = currentSeasonRows(all);
    const outcome = validateExperimentalCurrentSeason(season);

    return {
      season: season.length ? seasonLabel(seasonOf(season[0]!.date)) : "—",
      competitions: [...new Set(season.map((r) => r.league))].sort(),
      predictionAt,
      lineage: [...lineageMap.values()].sort((a, b) => b.observations - a.observations),
      outcome,
      matches: [...season].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  },
);
