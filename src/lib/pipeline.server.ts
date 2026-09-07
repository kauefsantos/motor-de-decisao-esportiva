// Orquestração do pipeline. Server-only.
// CSV Parser -> Match Resolver -> Data Collector -> Data Cleaner -> Feature Engine
// -> Probability Engine -> Opportunity Engine (Motor 1).

import { collectFromSources, adapterSources } from "./adapters/sources.server";
import { buildContracts } from "./engine/markets";
import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";

export type { PipelineStepKey } from "./pipeline.steps";
import type { PipelineStepKey } from "./pipeline.steps";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function log(
  db: Db,
  runId: string,
  step: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
  payload: Record<string, unknown> = {},
) {
  await db
    .from("pipeline_logs")
    .insert({ run_id: runId, step, level, message, payload: payload as never });
}

const SEPARATOR = /\s+(?:x|vs?|-)\s+/i;

function parseTeams(partida: string): { home: string | null; away: string | null } {
  const parts = partida.split(SEPARATOR);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0]!.trim(), away: parts[1]!.trim() };
}

function parseKickoff(targetDate: string | null, horario: string): string | null {
  const m = horario.match(/(\d{1,2})[:h](\d{2})/);
  if (!m) return null;
  const date = targetDate ?? new Date().toISOString().slice(0, 10);
  const hh = m[1]!.padStart(2, "0");
  // America/Sao_Paulo (UTC-03:00, sem horário de verão)
  return `${date}T${hh}:${m[2]}:00-03:00`;
}

export async function executeStep(runId: string, step: PipelineStepKey) {
  const db = await getDb();
  await db
    .from("analysis_runs")
    .update({ current_step: step, status: "RUNNING", updated_at: new Date().toISOString() })
    .eq("id", runId);

  switch (step) {
    case "RESOLVE":
      return resolveMatches(db, runId);
    case "COLLECT":
      return collect(db, runId);
    case "CLEAN":
      return clean(db, runId);
    case "FEATURES":
      return features(db, runId);
    case "PROBABILITY":
      return probability(db, runId);
    case "GATES":
      return gates(db, runId);
    case "MARKETS":
      return markets(db, runId);
  }
}

async function resolveMatches(db: Db, runId: string) {
  const { data: run } = await db.from("analysis_runs").select("target_date").eq("id", runId).single();
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, raw_horario, raw_campeonato")
    .eq("run_id", runId);

  const targetDate = run?.target_date ?? new Date().toISOString().slice(0, 10);
  let resolved = 0;
  let failed = 0;
  let external = 0;
  let ambiguous = 0;
  let notFound = 0;
  let sourceUnavailable = 0;
  let externalResearch = 0;
  let sourceError: string | null = null;

  for (const m of matches ?? []) {
    const { home, away } = parseTeams(m.raw_partida);
    const kickoff = parseKickoff(run?.target_date ?? null, m.raw_horario);
    const localOk = Boolean(home && away && kickoff);
    if (localOk) resolved++;
    else failed++;

    let status = localOk ? "RESOLVED_LOCAL" : "UNRESOLVED";
    let reason = localOk
      ? "Normalização local do CSV."
      : "Não foi possível separar mandante/visitante ou horário.";
    let confidence = localOk ? 0.6 : 0;

    let resolvedByApiFootball = false;
    if (localOk) {
      // Fonte principal: API-Football (credencial server-side). Nunca fabrica dados.
      const {
        apiFootballResolveMatch,
        apiFootballConfigured,
        apiFootballDefinitionVersion,
        apiFootballSource,
      } = await import("./adapters/api_football.server");
      const API_FOOTBALL_DEFINITION_VERSION = apiFootballDefinitionVersion();
      const API_FOOTBALL_SOURCE = apiFootballSource();

      if (apiFootballConfigured()) {
        const af = await apiFootballResolveMatch(
          { homeTeam: home, awayTeam: away, competition: m.raw_campeonato, kickoff },
          targetDate,
        );

        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: m.id,
          source: API_FOOTBALL_SOURCE,
          status: af.fetch.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
          http_status: af.fetch.httpStatus,
          error_message: af.fetch.errorMessage,
          fetched_at: af.fetch.fetchedAt,
        });

        if (af.resolution?.status === "MATCH_RESOLVED") {
          resolvedByApiFootball = true;
          external++;
          status = "RESOLVED_API_FOOTBALL";
          confidence = af.resolution.confidence;
          reason = af.resolution.reason;
          const event = af.events.find((e) => e.eventId === af.resolution!.eventId);
          await db.from("match_external_ids").insert([
            {
              match_id: m.id,
              source: "api_football_fixture",
              external_id: String(af.resolution.eventId),
              confidence: af.resolution.confidence,
            },
            ...(event?.homeTeamId
              ? [
                  {
                    match_id: m.id,
                    source: "api_football_team_home",
                    external_id: String(event.homeTeamId),
                    confidence: af.resolution.confidence,
                  },
                ]
              : []),
            ...(event?.awayTeamId
              ? [
                  {
                    match_id: m.id,
                    source: "api_football_team_away",
                    external_id: String(event.awayTeamId),
                    confidence: af.resolution.confidence,
                  },
                ]
              : []),
          ]);
        } else if (af.resolution) {
          reason = `${reason} API-Football: ${af.resolution.reason}`;
        } else {
          sourceUnavailable++;
          sourceError = af.fetch.errorMessage;
          reason = `${reason} API-Football indisponível: ${af.fetch.errorMessage ?? "sem detalhe"}.`;
        }

        await log(
          db,
          runId,
          "RESOLVE",
          `Resolução API-Football para ${m.raw_partida}: ${af.resolution?.status ?? af.fetch.status}`,
          resolvedByApiFootball ? "INFO" : "WARN",
          {
            definitionVersion: API_FOOTBALL_DEFINITION_VERSION,
            endpoint: af.fetch.endpoint,
            httpStatus: af.fetch.httpStatus,
            fetchedAt: af.fetch.fetchedAt,
            candidates: af.resolution?.candidates ?? [],
          },
        );
      } else {
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: m.id,
          source: API_FOOTBALL_SOURCE,
          status: "NOT_CONFIGURED",
          http_status: null,
          error_message: "API_FOOTBALL_KEY ausente no servidor.",
          fetched_at: new Date().toISOString(),
        });
      }
    }




    // Desk Research (fontes públicas e abertas). Não substitui os adapters acima:
    // roda sempre que houver times normalizados, para permitir coleta histórica.
    if (localOk) {
      const { researchResolveMatch, RESEARCH_SOURCE, RESEARCH_DEFINITION_VERSION } = await import(
        "./adapters/research.server"
      );
      const predictionAt = kickoff ?? new Date().toISOString();
      const research = await researchResolveMatch(
        { homeTeam: home, awayTeam: away, competition: m.raw_campeonato, kickoff },
        predictionAt,
      );

      for (const f of research.dataset.fetches) {
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: m.id,
          source: RESEARCH_SOURCE,
          status: f.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
          http_status: f.httpStatus,
          error_message: f.errorMessage ?? (f.status === "OK" ? `${f.url} (${f.rows} jogos)` : null),
          fetched_at: f.fetchedAt,
        });
      }

      if (research.dataset.fetches.length === 0) {
        reason = `${reason} Desk research: competição fora do catálogo público coberto.`;
      } else if (!research.resolution) {
        sourceUnavailable++;
        sourceError = research.dataset.fetches.find((f) => f.errorMessage)?.errorMessage ?? null;
        reason = `${reason} Desk research indisponível: ${sourceError ?? "nenhum dataset público legível"}.`;
      } else {
        const r = research.resolution;
        const url = research.dataset.fetches.find((f) => f.status === "OK")?.url ?? null;
        if (r.status === "MATCH_RESOLVED") {
          externalResearch++;
          if (!resolvedByApiFootball) {
            status = "RESOLVED_RESEARCH";
            confidence = r.confidence;
          }
          reason = `${reason} Desk research: ${r.reason}`;
          await db.from("match_external_ids").insert([
            {
              match_id: m.id,
              source: "research_team_home",
              external_id: r.home.team!,
              confidence: r.home.confidence,
            },
            {
              match_id: m.id,
              source: "research_team_away",
              external_id: r.away.team!,
              confidence: r.away.confidence,
            },
            ...(r.fixtureKey
              ? [
                  {
                    match_id: m.id,
                    source: "research_fixture",
                    external_id: r.fixtureKey,
                    confidence: r.confidence,
                  },
                ]
              : []),
            ...(research.dataset.leagueKey
              ? [
                  {
                    match_id: m.id,
                    source: "research_league",
                    external_id: research.dataset.leagueKey,
                    confidence: research.dataset.leagueSimilarity,
                  },
                ]
              : []),
          ]);
        } else {
          reason = `${reason} Desk research (${r.status}): ${r.reason}`;
        }

        await log(
          db,
          runId,
          "RESOLVE",
          `Desk research para ${m.raw_partida}: ${r.status}`,
          r.status === "MATCH_RESOLVED" ? "INFO" : "WARN",
          {
            mode: "Desk Research / Dados Públicos",
            definitionVersion: RESEARCH_DEFINITION_VERSION,
            sourceUrl: url,
            league: research.dataset.leagueLabel,
            resolvedAt: new Date().toISOString(),
            homeRaw: home,
            awayRaw: away,
            homeNormalized: r.home.team,
            awayNormalized: r.away.team,
            confidence: r.confidence,
            candidates: { home: r.home.candidates, away: r.away.candidates },
          },
        );
      }
    }



    await db
      .from("matches")
      .update({
        home_team: home,
        away_team: away,
        competition: m.raw_campeonato,
        kickoff_local: kickoff,
        resolution_status: status,
        resolution_reason: reason,
        resolver_confidence: confidence,
      })
      .eq("id", m.id);
  }

  await db
    .from("analysis_runs")
    .update({ matches_resolved: resolved, matches_failed: failed })
    .eq("id", runId);

  const summary = sourceUnavailable
    ? `${resolved} partidas normalizadas localmente; fonte indisponível em ${sourceUnavailable} consultas (${sourceError ?? "sem detalhe"}).`
    : `${resolved} partidas normalizadas; ${external} com evento externo, ${ambiguous} ambíguas, ${notFound} não encontradas.`;
  await log(
    db,
    runId,
    "RESOLVE",
    `${summary} Desk research reconheceu ${externalResearch} partidas em fontes públicas.`,
    external || externalResearch ? "INFO" : "WARN",
  );
  return { resolved, failed, external, externalResearch, ambiguous, notFound, sourceUnavailable };
}

async function collect(db: Db, runId: string) {
  const { data: matches } = await db
    .from("matches")
    .select("id, home_team, away_team, competition, kickoff_local, resolution_status")
    .eq("run_id", runId);

  const perSource: Record<string, number> = {};
  const predictionAt = new Date().toISOString();

  // 1) IDs externos já resolvidos por partida.
  const { data: externalIds } = await db
    .from("match_external_ids")
    .select("match_id, source, external_id")
    .in(
      "match_id",
      (matches ?? []).map((m) => m.id),
    );

  // 1a) API-Football: fonte principal, histórico pré-jogo por time resolvido.
  {
    const {
      apiFootballTeamHistory,
      apiFootballConfigured,
      apiFootballDefinitionVersion,
      apiFootballSource,
    } = await import("./adapters/api_football.server");
    const API_FOOTBALL_DEFINITION_VERSION = apiFootballDefinitionVersion();
    const API_FOOTBALL_SOURCE = apiFootballSource();

    let apiFootballObservations = 0;
    if (apiFootballConfigured()) {
      for (const m of matches ?? []) {
        const teams = (externalIds ?? []).filter(
          (e) =>
            e.match_id === m.id &&
            (e.source === "api_football_team_home" || e.source === "api_football_team_away"),
        );
        if (teams.length === 0) {
          perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] =
            (perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
          continue;
        }
        for (const team of teams) {
          const scope = team.source === "api_football_team_home" ? "HOME" : "AWAY";
          const history = await apiFootballTeamHistory(Number(team.external_id), predictionAt);
          for (const f of history.fetches) {
            perSource[`${API_FOOTBALL_SOURCE}:${f.status}`] =
              (perSource[`${API_FOOTBALL_SOURCE}:${f.status}`] ?? 0) + 1;
            await db.from("source_fetches").insert({
              run_id: runId,
              match_id: m.id,
              source: API_FOOTBALL_SOURCE,
              status: f.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
              http_status: f.httpStatus,
              error_message: f.errorMessage,
              fetched_at: f.fetchedAt,
            });
          }
          if (history.observations.length > 0) {
            apiFootballObservations += history.observations.length;
            await db.from("raw_observations").insert(
              history.observations.map((o) => ({
                run_id: runId,
                match_id: m.id,
                source: API_FOOTBALL_SOURCE,
                metric: `${scope}:${o.observation.canonical}`,
                raw_value: {
                  value: o.observation.value,
                  sourceLabel: o.observation.sourceLabel,
                  teamScope: scope,
                  statScope: o.observation.scope,
                  contractCompatible: o.observation.contractCompatible,
                  note: o.observation.note,
                  endpoint: o.endpoint,
                  fixtureId: o.fixtureId,
                  teamExternalId: team.external_id,
                } as never,
                observed_at: o.observedAt,
                fetched_at: o.fetchedAt,
                definition_version: API_FOOTBALL_DEFINITION_VERSION,
              })),
            );
          }
        }
      }
      await log(
        db,
        runId,
        "COLLECT",
        `${apiFootballObservations} observações brutas coletadas na API-Football.`,
        apiFootballObservations ? "INFO" : "WARN",
        { definitionVersion: API_FOOTBALL_DEFINITION_VERSION },
      );
    }
  }



  // 1b) Desk Research: histórico pré-jogo em datasets públicos e abertos.
  {
    const {
      researchDataset,
      researchTeamHistory,
      RESEARCH_SOURCE,
      RESEARCH_DEFINITION_VERSION,
    } = await import("./adapters/research.server");

    // Cache: observações já coletadas antes (qualquer run) para a mesma chave.
    const { data: cachedRows } = await db
      .from("raw_observations")
      .select("metric, raw_value, observed_at, fetched_at")
      .eq("source", RESEARCH_SOURCE)
      .eq("definition_version", RESEARCH_DEFINITION_VERSION)
      .limit(5000);
    const cacheIndex = new Map<string, typeof cachedRows>();
    for (const row of cachedRows ?? []) {
      const key = (row.raw_value as { cacheKey?: string } | null)?.cacheKey;
      if (!key) continue;
      const list = cacheIndex.get(key) ?? [];
      list.push(row);
      cacheIndex.set(key, list);
    }

    let researchObservations = 0;
    let reusedFromCache = 0;
    let insufficient = 0;

    for (const m of matches ?? []) {
      const teams = (externalIds ?? []).filter(
        (e) =>
          e.match_id === m.id &&
          (e.source === "research_team_home" || e.source === "research_team_away"),
      );
      if (teams.length === 0) {
        perSource[`${RESEARCH_SOURCE}:NO_TEAM_RESOLVED`] =
          (perSource[`${RESEARCH_SOURCE}:NO_TEAM_RESOLVED`] ?? 0) + 1;
        continue;
      }

      const predictionAt = m.kickoff_local ?? new Date().toISOString();
      const cutoffDay = predictionAt.slice(0, 10);
      let dataset: Awaited<ReturnType<typeof researchDataset>> | null = null;

      for (const team of teams) {
        const scope = team.source === "research_team_home" ? "HOME" : "AWAY";
        const cacheKey = `${RESEARCH_DEFINITION_VERSION}|${team.external_id}|${cutoffDay}`;
        const cached = cacheIndex.get(cacheKey);

        if (cached && cached.length > 0) {
          reusedFromCache += cached.length;
          researchObservations += cached.length;
          await db.from("raw_observations").insert(
            cached.map((c) => ({
              run_id: runId,
              match_id: m.id,
              source: RESEARCH_SOURCE,
              metric: c.metric,
              raw_value: { ...(c.raw_value as object), reusedFromCache: true } as never,
              observed_at: c.observed_at,
              fetched_at: c.fetched_at,
              definition_version: RESEARCH_DEFINITION_VERSION,
            })),
          );
          continue;
        }

        if (!dataset) {
          dataset = await researchDataset(m.competition, predictionAt);
          for (const f of dataset.fetches) {
            perSource[`${RESEARCH_SOURCE}:${f.status}`] =
              (perSource[`${RESEARCH_SOURCE}:${f.status}`] ?? 0) + 1;
            await db.from("source_fetches").insert({
              run_id: runId,
              match_id: m.id,
              source: RESEARCH_SOURCE,
              status: f.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
              http_status: f.httpStatus,
              error_message:
                f.errorMessage ?? (f.status === "OK" ? `${f.url} (${f.rows} jogos)` : null),
              fetched_at: f.fetchedAt,
            });
          }
        }

        const history = researchTeamHistory(team.external_id, dataset, predictionAt);
        if (history.historyStatus === "INSUFFICIENT_HISTORY") insufficient += 1;

        if (history.observations.length === 0) {
          perSource[`${RESEARCH_SOURCE}:NO_HISTORY`] =
            (perSource[`${RESEARCH_SOURCE}:NO_HISTORY`] ?? 0) + 1;
          continue;
        }

        researchObservations += history.observations.length;
        const fetchedAt = new Date().toISOString();
        const rows = history.observations.map((o) => ({
          run_id: runId,
          match_id: m.id,
          source: RESEARCH_SOURCE,
          metric: `${scope}:${o.canonical}`,
          raw_value: {
            value: o.value,
            valueRaw: o.valueRaw,
            metricLabelRaw: o.metricLabelRaw,
            unit: o.unit,
            period: o.period,
            sourceLabel: o.metricLabelRaw,
            teamScope: scope,
            statScope: o.venue,
            contractCompatible: o.contractCompatible,
            note: o.note,
            sourceUrl: o.sourceUrl,
            team: team.external_id,
            externalMatchId: o.fixtureKey,
            fixtureDate: o.fixtureDate,
            opponent: o.opponent,
            predictionAt,
            historyStatus: history.historyStatus,
            cacheKey,
            mode: "Desk Research / Dados Públicos",
          } as never,
          observed_at: `${o.fixtureDate}T00:00:00Z`,
          fetched_at: fetchedAt,
          definition_version: RESEARCH_DEFINITION_VERSION,
        }));
        for (let i = 0; i < rows.length; i += 200) {
          await db.from("raw_observations").insert(rows.slice(i, i + 200));
        }

        await log(
          db,
          runId,
          "COLLECT",
          `Desk research: ${history.found}/${history.requested} jogos anteriores de ${team.external_id} (${history.historyStatus}).`,
          history.historyStatus === "OK" ? "INFO" : "WARN",
          {
            mode: "Desk Research / Dados Públicos",
            definitionVersion: RESEARCH_DEFINITION_VERSION,
            team: team.external_id,
            predictionAt,
            fixtures: history.fixturesUsed,
            observations: history.observations.length,
          },
        );
      }
    }

    await log(
      db,
      runId,
      "COLLECT",
      researchObservations
        ? `Desk research coletou ${researchObservations} observações brutas em fontes públicas (${reusedFromCache} reaproveitadas do cache); ${insufficient} times com histórico insuficiente.`
        : "Desk research não encontrou fonte pública utilizável para as partidas desta rodada.",
      researchObservations ? "INFO" : "WARN",
      { reusedFromCache, insufficient },
    );
  }


  // 2) Demais fontes (não configuradas até haver credencial/endpoint).
  for (const m of matches ?? []) {
    const results = await collectFromSources({
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      competition: m.competition,
      kickoff: m.kickoff_local,
      predictionAt,
    });
    for (const r of results) {
      perSource[`${r.source}:${r.status}`] = (perSource[`${r.source}:${r.status}`] ?? 0) + 1;
      await db.from("source_fetches").insert({
        run_id: runId,
        match_id: m.id,
        source: r.source,
        status: r.status,
        http_status: r.httpStatus,
        error_message: r.errorMessage,
        fetched_at: r.fetchedAt,
      });
      if (r.observations.length > 0) {
        await db.from("raw_observations").insert(
          r.observations.map((o) => ({
            run_id: runId,
            match_id: m.id,
            source: r.source,
            metric: o.metric,
            raw_value: o.rawValue as never,
            observed_at: o.observedAt,
            fetched_at: r.fetchedAt,
            definition_version: r.definitionVersion,
          })),
        );
      }
    }
  }

  await log(
    db,
    runId,
    "COLLECT",
    `Coleta concluída. Estado por fonte registrado em source_fetches.`,
    "INFO",
    perSource,
  );
  return perSource;
}

async function clean(db: Db, runId: string) {
  const { data: raws } = await db
    .from("raw_observations")
    .select("id, match_id, source, metric, raw_value, fetched_at, definition_version")
    .eq("run_id", runId);

  await db.from("normalized_match_stats").delete().eq("run_id", runId);

  const { crossCheck } = await import("./adapters/research.parse");

  type RawValue = {
    value?: number;
    sourceLabel?: string;
    statScope?: "HOME" | "AWAY";
    contractCompatible?: boolean;
    note?: string;
    sourceUrl?: string;
    metricLabelRaw?: string;
    valueRaw?: string;
    externalMatchId?: string;
    fixtureDate?: string;
    predictionAt?: string;
  };

  // Agrega por (partida, escopo, métrica) apenas o que passou no definition gate.
  const buckets = new Map<
    string,
    {
      matchId: string | null;
      scope: string;
      metric: string;
      values: number[];
      perSource: Map<string, number[]>;
      definitionVersion: string | null;
      lineage: Array<Record<string, unknown>>;
    }
  >();
  let rejectedByDefinition = 0;
  const rejectedDetail: Record<string, number> = {};

  for (const r of raws ?? []) {
    const v = (r.raw_value ?? {}) as RawValue;
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
    const [teamScope, canonical] = r.metric.split(":");
    if (!teamScope || !canonical) continue;
    if (v.contractCompatible !== true) {
      rejectedByDefinition += 1;
      const key = `${r.source}:${canonical}`;
      rejectedDetail[key] = (rejectedDetail[key] ?? 0) + 1;
      continue;
    }
    const key = `${r.match_id}|${teamScope}|${canonical}`;
    const bucket = buckets.get(key) ?? {
      matchId: r.match_id,
      scope: teamScope,
      metric: canonical,
      values: [],
      perSource: new Map<string, number[]>(),
      definitionVersion: r.definition_version,
      lineage: [],
    };
    bucket.values.push(v.value);
    const bySource = bucket.perSource.get(r.source) ?? [];
    bySource.push(v.value);
    bucket.perSource.set(r.source, bySource);
    bucket.lineage.push({
      rawObservationId: r.id,
      source: r.source,
      sourceUrl: v.sourceUrl ?? null,
      fetchedAt: r.fetched_at,
      rawValue: v.valueRaw ?? v.value,
      normalizedValue: v.value,
      canonicalMetric: canonical,
      metricLabelRaw: v.metricLabelRaw ?? v.sourceLabel ?? null,
      sourceLabel: v.sourceLabel ?? null,
      statScope: v.statScope ?? null,
      externalMatchId: v.externalMatchId ?? null,
      observedDate: v.fixtureDate ?? null,
      predictionAt: v.predictionAt ?? null,
      definitionVersion: r.definition_version,
      note: v.note ?? null,
    });
    buckets.set(key, bucket);
  }

  let conflicts = 0;
  let confirmed = 0;

  const rows = [...buckets.values()].map((b) => {
    const perSource = [...b.perSource.entries()].map(([source, values]) => ({
      source,
      value: values.reduce((a, c) => a + c, 0) / values.length,
      sampleSize: values.length,
    }));
    const status = crossCheck(perSource);
    if (status === "SOURCE_CONFLICT") conflicts += 1;
    if (status === "CROSS_SOURCE_CONFIRMED") confirmed += 1;
    return {
      run_id: runId,
      match_id: b.matchId,
      scope: b.scope,
      metric: b.metric,
      normalized_value: b.values.reduce((a, c) => a + c, 0) / b.values.length,
      sample_size: b.values.length,
      source: perSource.map((p) => p.source).join("+"),
      definition_version: b.definitionVersion,
      lineage: { observations: b.lineage, crossCheck: { status, perSource } } as never,
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    await db.from("normalized_match_stats").insert(rows.slice(i, i + 200));
  }

  await log(
    db,
    runId,
    "CLEAN",
    rows.length
      ? `${rows.length} métricas normalizadas com lineage; ${rejectedByDefinition} observações descartadas por definição incompatível; ${confirmed} confirmadas entre fontes e ${conflicts} em conflito.`
      : `Nenhuma métrica normalizada (${rejectedByDefinition} observações descartadas por definição incompatível). Nada foi preenchido com média global.`,
    rows.length ? "INFO" : "WARN",
    { rejectedByDefinition, rejectedDetail, crossSourceConfirmed: confirmed, sourceConflicts: conflicts },
  );
  return {
    normalized: rows.length,
    rejectedByDefinition,
    rejectedDetail,
    crossSourceConfirmed: confirmed,
    sourceConflicts: conflicts,
    rawObservations: raws?.length ?? 0,
  };
}



async function features(db: Db, runId: string) {
  const { count } = await db
    .from("normalized_match_stats")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  await log(
    db,
    runId,
    "FEATURES",
    count
      ? `${count} features normalizadas disponíveis.`
      : "Sem estatísticas normalizadas: nenhuma feature pôde ser construída.",
    count ? "INFO" : "WARN",
  );
  return { features: count ?? 0 };
}

async function probability(db: Db, runId: string) {
  const { data: versions } = await db
    .from("model_versions")
    .select("market_family, validation_status, calibration_version");
  const validated = (versions ?? []).filter(
    (v) => v.validation_status === "PRODUCTION_VALIDATED" && v.calibration_version,
  );
  await log(
    db,
    runId,
    "PROBABILITY",
    validated.length
      ? `${validated.length} famílias com modelo calibrado e validado.`
      : "Nenhuma família de mercado possui modelo calibrado e validado out-of-sample; nenhuma probabilidade foi inventada.",
    validated.length ? "INFO" : "WARN",
  );
  return { validatedFamilies: validated.length };
}

async function gates(db: Db, runId: string) {
  await log(db, runId, "GATES", "Gate-base aplicado: binários p_cal >= 0,65; asiáticos p_profit_cal >= 0,65.");
  return { gate: 0.65 };
}

async function markets(db: Db, runId: string) {
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true });

  const { data: versions } = await db
    .from("model_versions")
    .select("market_family, model_version, calibration_version, validation_status");
  const registry = new Map<string, ModelRegistryEntry>(
    (versions ?? []).map((v) => [
      v.market_family,
      {
        family: v.market_family,
        modelVersion: v.model_version,
        calibrationVersion: v.calibration_version,
        validationStatus: v.validation_status,
      },
    ]),
  );

  const { data: normalized } = await db
    .from("normalized_match_stats")
    .select("match_id, metric, normalized_value, sample_size, source, definition_version")
    .eq("run_id", runId);

  await db.from("market_candidates").delete().eq("run_id", runId);

  let published = 0;
  let blocked = 0;
  let index = 0;

  for (const m of matches ?? []) {
    const ctx: MatchContext = {
      matchId: m.id,
      matchLabel: m.home_team && m.away_team ? `${m.home_team} x ${m.away_team}` : m.raw_partida,
      league: m.competition ?? "",
      kickoff: m.kickoff_local,
      predictionAt: new Date().toISOString(),
      features: new Map(
        (normalized ?? [])
          .filter((n) => n.match_id === m.id)
          .map((n) => [
            n.metric,
            {
              metric: n.metric,
              value: Number(n.normalized_value ?? 0),
              sampleSize: n.sample_size ?? 0,
              source: n.source ?? "",
              definitionVersion: n.definition_version ?? "",
              definitionCompatible: true,
            },
          ]),
      ),
      countDistributions: new Map(),
      binaryProbabilities: new Map(),
      sources: [],
    };

    const contracts = buildContracts({
      home: m.home_team ?? "Mandante",
      away: m.away_team ?? "Visitante",
    });

    const rows = contracts.map((contract) => {
      index += 1;
      const out = evaluateContract(ctx, contract, registry, index);
      if (out.published) published += 1;
      else blocked += 1;
      return {
        run_id: runId,
        match_id: m.id,
        prediction_id: out.predictionId,
        market: out.market,
        market_family: out.family,
        participant: out.participant,
        side: out.side,
        line_raw: out.lineRaw,
        line_canonical: out.lineCanonical,
        market_label: out.marketLabel,
        p_cal: out.pCal,
        p_cons: out.pCons,
        fair_odd_info: out.fairOddInfo,
        confidence_score: out.confidenceScore,
        data_quality_score: out.dataQualityScore,
        sample_reliability: out.sampleReliability,
        uncertainty: out.uncertainty,
        stability: out.stability,
        market_score: out.marketScore,
        settlement_definition: out.settlementDefinition,
        model_status: out.modelStatus,
        data_status: out.dataStatus,
        published: out.published,
        block_reason: out.blockReason,
        reason_short: out.reasonShort,
        sources: out.sources as never,
      };
    });

    for (let i = 0; i < rows.length; i += 200) {
      await db.from("market_candidates").insert(rows.slice(i, i + 200));
    }
  }

  await db
    .from("analysis_runs")
    .update({
      candidates_published: published,
      candidates_blocked: blocked,
      status: "READY_FOR_ODDS",
      current_step: "MARKETS",
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  await log(
    db,
    runId,
    "MARKETS",
    `${published} contratos publicados para observação, ${blocked} bloqueados por gates/dados/modelo.`,
    published ? "INFO" : "WARN",
  );
  return { published, blocked };
}
