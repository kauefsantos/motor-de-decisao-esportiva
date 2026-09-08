from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(s.replace(old, new, 1))


# 1) Pipeline: continental/cross-league fixtures need team-wide history, not
# only the competition-specific ledger.
replace_once(
    "src/lib/pipeline.server.ts",
    'import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";\n',
    'import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";\nimport { isCrossLeagueCompetitionName } from "./competition-kind";\n',
)
replace_once(
    "src/lib/pipeline.server.ts",
    '        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");\n        if (teams.length === 0) {',
    '        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");\n        const crossLeague = isCrossLeagueCompetitionName(m.competition);\n        if (teams.length === 0) {',
)
replace_once(
    "src/lib/pipeline.server.ts",
    '          if (leagueExternal?.external_id) {\n',
    '          if (leagueExternal?.external_id && !crossLeague) {\n',
)
replace_once(
    "src/lib/pipeline.server.ts",
    '            history = await fiveDollarTeamHistory(Number(team.external_id), predictionAt, 20);\n',
    '            history = await fiveDollarTeamHistory(Number(team.external_id), predictionAt, crossLeague ? 40 : 20);\n',
)


# 2) Experimental runner: page all raw observations and use domestic-history
# fallbacks for continental matches.
p = Path("src/lib/experimental-markets-run.functions.ts")
s = p.read_text()
old_import = 'import { eloAdjustGoalForecast } from "./elo-feature.server";\n'
new_import = (
    'import { eloAdjustGoalForecast } from "./elo-feature.server";\n'
    'import { isCrossLeagueCompetitionName, isCrossLeagueLeagueKey } from "./competition-kind";\n'
    'import { CROSS_LEAGUE_MODEL_SUFFIX, crossLeagueCornersForecast, crossLeagueGoalForecast } from "./engine/cross-league";\n'
    'import { loadFiveDollarRawValues, loadRunFiveDollarRawValues } from "./raw-observations.server";\n'
)
if old_import not in s:
    raise SystemExit("experimental imports marker not found")
s = s.replace(old_import, new_import, 1)

old_load = '''    const [{ data: externalIds }, { data: runRaws }, { data: historicalRaws }] =
      await Promise.all([
        supabase
          .from("match_external_ids")
          .select("match_id, source, external_id")
          .in("match_id", matchIds),
        supabase
          .from("raw_observations")
          .select("match_id, raw_value")
          .eq("run_id", data.runId)
          .eq("source", SOURCE)
          .limit(5000),
        supabase
          .from("raw_observations")
          .select("raw_value")
          .eq("source", SOURCE)
          .limit(10000),
      ]);
'''
new_load = '''    const [{ data: externalIds }, runRaws, historicalRaws] = await Promise.all([
      supabase
        .from("match_external_ids")
        .select("match_id, source, external_id")
        .in("match_id", matchIds),
      loadRunFiveDollarRawValues(supabase, data.runId),
      loadFiveDollarRawValues(supabase, predictionAt, 365),
    ]);
'''
if old_load not in s:
    raise SystemExit("historical loader block not found")
s = s.replace(old_load, new_load, 1)
s = s.replace('(historicalRaws ?? [])\n        .map', 'historicalRaws\n        .map', 1)
s = s.replace('(runRaws ?? []) as { match_id: string | null; raw_value: unknown }[]', 'runRaws as { match_id: string | null; raw_value: unknown }[]', 1)

corner_start = s.index('      const cornerTraining = datasets.corners.filter(')
goal_start = s.index('      const goalTraining = datasets.goals.filter(', corner_start)
new_corner = '''      const crossLeague =
        isCrossLeagueCompetitionName(match.competition) || isCrossLeagueLeagueKey(league);
      const rollingCorners = datasets.corners.filter(
        (r) => r.date < predictionDate && r.date >= rollingStartDate,
      );
      let cornerForecast: { lambdaHome: number; lambdaAway: number; lambdaTotal: number; sampleSize: number } | null = null;
      let cornerTrainingMatches = 0;
      let cornerModelVersion = CORNERS_MODEL_VERSION;

      if (crossLeague) {
        const crossCorners = crossLeagueCornersForecast(rollingCorners, {
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        if (crossCorners) {
          cornerForecast = crossCorners;
          cornerTrainingMatches = crossCorners.trainingMatches;
          cornerModelVersion = `${CORNERS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`;
        } else {
          issues.push(`${label}: escanteios continentais sem amostra doméstica suficiente para os dois clubes.`);
        }
      } else {
        const cornerTraining = rollingCorners.filter((r) => r.league === league);
        if (cornerTraining.length >= MIN_EXPERIMENTAL_MATCHES) {
          const params = fitCornersBaseline(cornerTraining);
          const forecast = predictCorners(params, {
            league,
            homeTeam: String(homeId),
            awayTeam: String(awayId),
          });
          if (forecast.sampleSize > 0) {
            cornerForecast = forecast;
            cornerTrainingMatches = cornerTraining.length;
          }
        }
      }

      if (cornerForecast && cornerForecast.sampleSize > 0) {
        const specs = [
          {
            market: "corners_match_total",
            participant: null,
            line: "9.5",
            dist: poissonDistribution(cornerForecast.lambdaTotal),
          },
          {
            market: "corners_match_total",
            participant: null,
            line: "10.5",
            dist: poissonDistribution(cornerForecast.lambdaTotal),
          },
          {
            market: "corners_team_total",
            participant: match.home_team ?? "Mandante",
            line: "4.5",
            dist: poissonDistribution(cornerForecast.lambdaHome),
          },
          {
            market: "corners_team_total",
            participant: match.away_team ?? "Visitante",
            line: "4.5",
            dist: poissonDistribution(cornerForecast.lambdaAway),
          },
        ];
        let ordinal = 0;
        for (const spec of specs) {
          for (const side of ["OVER", "UNDER"] as const) {
            ordinal += 1;
            const line = canonicalLine(spec.line);
            const outcomes = asianOutcomes(spec.dist, line, side);
            const p = pProfit(outcomes);
            const id = predictionId(data.runId, match.id, "CORNERS", ordinal);
            predictionRows.push({
              run_id: data.runId,
              match_id: match.id,
              prediction_id: id,
              market: spec.market,
              participant: spec.participant,
              side,
              line_raw: spec.line,
              line_canonical: line,
              model_probability: p,
              p_cal: null,
              conservative_probability: null,
              outcome_distribution: outcomes,
              model_version: cornerModelVersion,
              calibration_version: null,
              model_status: EXPERIMENTAL_MARKETS_STATUS,
              data_status: "OK",
              prediction_at: predictionAt,
            });
            candidates.push({
              predictionId: id,
              matchId: match.id,
              matchLabel: label,
              competition: match.competition ?? "",
              family: "CORNERS",
              market: spec.market,
              marketLabel: labelFor(spec.market, spec.participant, side, spec.line),
              participant: spec.participant,
              side,
              lineRaw: spec.line,
              lineCanonical: line,
              contractType: "ASIAN",
              probabilityExperimental: p,
              fairOddExperimental: asianFairOdd(outcomes),
              sampleSize: cornerForecast.sampleSize,
              trainingMatches: cornerTrainingMatches,
              gate: BASE_GATE,
              gateMet: p >= BASE_GATE,
              modelVersion: cornerModelVersion,
              modelStatus: EXPERIMENTAL_MARKETS_STATUS,
              productionStatus: PRODUCTION_STATUS,
              dataStatus: "OK",
            });
          }
        }
      }

'''
s = s[:corner_start] + new_corner + s[goal_start:]

goal_start = s.index('      const goalTraining = datasets.goals.filter(')
projections_start = s.index('      const projections = buildGoalMarketProjections({', goal_start)
new_goal = '''      const rollingGoals = datasets.goals.filter(
        (r) => r.date < predictionDate && r.date >= rollingStartDate,
      );
      let goalForecast: { lambdaHome: number; lambdaAway: number; lambdaTotal: number; sampleSize: number } | null = null;
      let goalTrainingMatches = 0;
      let adjustedLambdaHome = 0;
      let adjustedLambdaAway = 0;
      let goalModelVersion = GOALS_MODEL_VERSION;

      if (crossLeague) {
        const crossGoals = crossLeagueGoalForecast(rollingGoals, {
          homeTeam: String(homeId),
          awayTeam: String(awayId),
          referenceDate: predictionDate,
        });
        if (!crossGoals) {
          issues.push(`${label}: gols continentais sem pelo menos ${MIN_EXPERIMENTAL_MATCHES} partidas domésticas válidas para cada clube nos últimos 365 dias.`);
          continue;
        }
        goalForecast = crossGoals;
        goalTrainingMatches = crossGoals.trainingMatches;
        adjustedLambdaHome = crossGoals.lambdaHome;
        adjustedLambdaAway = crossGoals.lambdaAway;
        goalModelVersion = `${GOALS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`;
        issues.push(
          `${label}: baseline continental usa histórico doméstico (${crossGoals.homeDomesticLeague} x ${crossGoals.awayDomesticLeague}); Elo cross-country não aplicado sem normalização validada.`,
        );
      } else {
        const goalTraining = rollingGoals.filter((r) => r.league === league);
        if (goalTraining.length < MIN_EXPERIMENTAL_MATCHES) {
          issues.push(
            `${label}: gols com ${goalTraining.length} partida(s) nos últimos 365 dias; mínimo experimental ${MIN_EXPERIMENTAL_MATCHES}.`,
          );
          continue;
        }
        const goalParams = fitGoalsBaseline(goalTraining, predictionDate);
        goalForecast = predictGoals(goalParams, {
          league,
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        goalTrainingMatches = goalTraining.length;
        if (goalForecast.sampleSize < 1) {
          issues.push(`${label}: pelo menos um time não possui partida própria de gols nos últimos 365 dias.`);
          continue;
        }

        const eloForecast = await eloAdjustGoalForecast({
          runId: data.runId,
          matchId: match.id,
          leagueKey: league,
          homeTeamId: Number(homeId),
          awayTeamId: Number(awayId),
          predictionAt,
          lambdaHome: goalForecast.lambdaHome,
          lambdaAway: goalForecast.lambdaAway,
        });
        adjustedLambdaHome = eloForecast.lambdaHome;
        adjustedLambdaAway = eloForecast.lambdaAway;
        if (!eloForecast.applied) {
          issues.push(`${label}: ${eloForecast.reason} Mantido o baseline de gols sem ajuste Elo.`);
        } else if (eloForecast.modelVersionSuffix) {
          goalModelVersion = `${GOALS_MODEL_VERSION}+${eloForecast.modelVersionSuffix}`;
        }
      }

      if (!goalForecast) continue;

'''
s = s[:goal_start] + new_goal + s[projections_start:]
s = s.replace(
    '        lambdaHome: eloForecast.lambdaHome,\n        lambdaAway: eloForecast.lambdaAway,',
    '        lambdaHome: adjustedLambdaHome,\n        lambdaAway: adjustedLambdaAway,',
    1,
)
marker = '          sampleSize: goalForecast.sampleSize,\n          trainingMatches: goalTraining.length,'
if marker not in s:
    raise SystemExit("goal candidate training marker not found")
s = s.replace(marker, '          sampleSize: goalForecast.sampleSize,\n          trainingMatches: goalTrainingMatches,', 1)
p.write_text(s)


# 3) Expand server-side Elo sync to the domestic leagues relevant to Pro.
p = Path("src/lib/elo-sync.server.ts")
s = p.read_text()
old_target = '''  if (country === "GB-ENG") return n === "premier league" || n === "england premier league";
  if (country === "DE") return n === "bundesliga" || n === "germany bundesliga";
  if (country === "ES") return n === "la liga" || n === "spain la liga";
  if (country === "IT") return n === "serie a" || n === "italy serie a";
  if (country === "FR") return n === "ligue 1" || n === "france ligue 1";
  if (country === "BR") {
    return /(^| )(brazil |brasil )?serie [ab]$/.test(n) || /brasileirao serie [ab]$/.test(n);
  }
  return false;
'''
new_target = '''  if (country === "GB-ENG") return /england (premier league|championship)$/.test(n) || n === "premier league" || n === "championship";
  if (country === "DE") return /germany bundesliga (i|ii)$/.test(n) || /bundesliga (i|ii)$/.test(n);
  if (country === "ES") return n === "spain la liga" || n === "la liga" || n === "spain segunda";
  if (country === "IT") return /(^|italy )serie [ab]$/.test(n);
  if (country === "FR") return /(^|france )ligue [12]$/.test(n);
  if (country === "BR") return /(^| )(brazil |brasil )?serie [ab]$/.test(n) || /brasileirao serie [ab]$/.test(n);
  if (country === "NL") return n === "netherlands eredivisie" || n === "netherlands eerste divisie";
  if (country === "PT") return n === "portugal primeira liga" || n === "portugal segunda liga";
  if (country === "TR") return n === "turkiye super lig" || n === "turkiye 1 lig";
  if (country === "SK") return n === "slovakia super liga";
  if (country === "NO") return n === "norway eliteserien" || n === "norway division 1";
  if (country === "AR") return n === "argentina liga profesional" || n === "argentina nacional b";
  if (country === "EC") return n === "ecuador ligapro serie a" || n === "ecuador ligapro serie b";
  return false;
'''
if old_target not in s:
    raise SystemExit("elo target block not found")
s = s.replace(old_target, new_target, 1)
s = s.replace(
    '  const countries = ["GB-ENG", "DE", "ES", "IT", "FR", "BR"];',
    '  const countries = ["GB-ENG", "DE", "ES", "IT", "FR", "BR", "NL", "PT", "TR", "SK", "NO", "AR", "EC"];',
    1,
)
p.write_text(s)
