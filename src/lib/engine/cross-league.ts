import { isLikelyDomesticLeagueKey } from "../competition-kind";
import {
  fitBaseline as fitCornersBaseline,
  type CornerMatchRow,
  type CornersModelParams,
} from "./corners";
import {
  fitGoalsBaseline,
  type GoalMatchRow,
  type GoalsModelParams,
} from "./goals";

export const CROSS_LEAGUE_MODEL_SUFFIX = "cross-league-domestic-v1";
const MIN_TEAM_MATCHES = 3;

function teamKey(league: string, team: string) {
  return `${league}::${team}`;
}

function appearances<T extends { league: string; homeTeam: string; awayTeam: string }>(
  rows: T[],
  teamId: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isLikelyDomesticLeagueKey(row.league)) continue;
    if (row.homeTeam !== teamId && row.awayTeam !== teamId) continue;
    counts.set(row.league, (counts.get(row.league) ?? 0) + 1);
  }
  return counts;
}

export function primaryDomesticLeague<T extends { league: string; homeTeam: string; awayTeam: string }>(
  rows: T[],
  teamId: string,
): { league: string; matches: number } | null {
  const ranked = [...appearances(rows, teamId).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0];
  return top ? { league: top[0], matches: top[1] } : null;
}

function geometricMean(values: Array<number | undefined>): number {
  const usable = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (usable.length === 0) return 1;
  return Math.exp(usable.reduce((sum, v) => sum + Math.log(v), 0) / usable.length);
}

function clampFactor(value: number): number {
  return Math.min(1.35, Math.max(0.75, value));
}

function goalStrength(params: GoalsModelParams, league: string, team: string) {
  const key = teamKey(league, team);
  return {
    attack: clampFactor(geometricMean([params.attack[key]?.home, params.attack[key]?.away])),
    defense: clampFactor(geometricMean([params.defense[key]?.home, params.defense[key]?.away])),
    sample: params.sampleSizes[key] ?? 0,
  };
}

function cornerStrength(params: CornersModelParams, league: string, team: string) {
  const key = teamKey(league, team);
  return {
    attack: clampFactor(geometricMean([params.attack[key]?.home, params.attack[key]?.away])),
    defense: clampFactor(geometricMean([params.defense[key]?.home, params.defense[key]?.away])),
    sample: params.sampleSizes[key] ?? 0,
  };
}

export type CrossLeagueForecast = {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  sampleSize: number;
  trainingMatches: number;
  homeDomesticLeague: string;
  awayDomesticLeague: string;
};

export function crossLeagueGoalForecast(
  rows: GoalMatchRow[],
  input: { homeTeam: string; awayTeam: string; referenceDate: string },
): CrossLeagueForecast | null {
  const homeDomestic = primaryDomesticLeague(rows, input.homeTeam);
  const awayDomestic = primaryDomesticLeague(rows, input.awayTeam);
  if (!homeDomestic || !awayDomestic) return null;
  if (homeDomestic.matches < MIN_TEAM_MATCHES || awayDomestic.matches < MIN_TEAM_MATCHES) return null;

  const homeLeagueRows = rows.filter((r) => r.league === homeDomestic.league);
  const awayLeagueRows = rows.filter((r) => r.league === awayDomestic.league);
  if (homeLeagueRows.length < MIN_TEAM_MATCHES || awayLeagueRows.length < MIN_TEAM_MATCHES) return null;

  const homeParams = fitGoalsBaseline(homeLeagueRows, input.referenceDate);
  const awayParams = homeDomestic.league === awayDomestic.league
    ? homeParams
    : fitGoalsBaseline(awayLeagueRows, input.referenceDate);
  const hs = goalStrength(homeParams, homeDomestic.league, input.homeTeam);
  const as = goalStrength(awayParams, awayDomestic.league, input.awayTeam);
  if (hs.sample < MIN_TEAM_MATCHES || as.sample < MIN_TEAM_MATCHES) return null;

  const homeBaseHome = homeParams.leagueMeanHome[homeDomestic.league] ?? homeParams.globalMeanHome;
  const awayBaseHome = awayParams.leagueMeanHome[awayDomestic.league] ?? awayParams.globalMeanHome;
  const homeBaseAway = homeParams.leagueMeanAway[homeDomestic.league] ?? homeParams.globalMeanAway;
  const awayBaseAway = awayParams.leagueMeanAway[awayDomestic.league] ?? awayParams.globalMeanAway;
  const baseHome = (homeBaseHome + awayBaseHome) / 2;
  const baseAway = (homeBaseAway + awayBaseAway) / 2;

  // As forças são relativas à própria liga e o expoente 1/2 reduz dupla contagem.
  // Este baseline permanece doméstico; a normalização entre ligas, quando elegível,
  // é aplicada depois pela camada Elo hierárquica compartilhada.
  const lambdaHome = Math.max(0.05, baseHome * Math.sqrt(hs.attack * as.defense));
  const lambdaAway = Math.max(0.05, baseAway * Math.sqrt(as.attack * hs.defense));
  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
    sampleSize: Math.min(hs.sample, as.sample),
    trainingMatches: homeDomestic.league === awayDomestic.league
      ? homeLeagueRows.length
      : homeLeagueRows.length + awayLeagueRows.length,
    homeDomesticLeague: homeDomestic.league,
    awayDomesticLeague: awayDomestic.league,
  };
}

export function crossLeagueCornersForecast(
  rows: CornerMatchRow[],
  input: { homeTeam: string; awayTeam: string },
): CrossLeagueForecast | null {
  const homeDomestic = primaryDomesticLeague(rows, input.homeTeam);
  const awayDomestic = primaryDomesticLeague(rows, input.awayTeam);
  if (!homeDomestic || !awayDomestic) return null;
  if (homeDomestic.matches < MIN_TEAM_MATCHES || awayDomestic.matches < MIN_TEAM_MATCHES) return null;

  const homeLeagueRows = rows.filter((r) => r.league === homeDomestic.league);
  const awayLeagueRows = rows.filter((r) => r.league === awayDomestic.league);
  if (homeLeagueRows.length < MIN_TEAM_MATCHES || awayLeagueRows.length < MIN_TEAM_MATCHES) return null;

  const homeParams = fitCornersBaseline(homeLeagueRows);
  const awayParams = homeDomestic.league === awayDomestic.league
    ? homeParams
    : fitCornersBaseline(awayLeagueRows);
  const hs = cornerStrength(homeParams, homeDomestic.league, input.homeTeam);
  const as = cornerStrength(awayParams, awayDomestic.league, input.awayTeam);
  if (hs.sample < MIN_TEAM_MATCHES || as.sample < MIN_TEAM_MATCHES) return null;

  const homeBaseHome = homeParams.leagueMeanHome[homeDomestic.league] ?? homeParams.globalMeanHome;
  const awayBaseHome = awayParams.leagueMeanHome[awayDomestic.league] ?? awayParams.globalMeanHome;
  const homeBaseAway = homeParams.leagueMeanAway[homeDomestic.league] ?? homeParams.globalMeanAway;
  const awayBaseAway = awayParams.leagueMeanAway[awayDomestic.league] ?? awayParams.globalMeanAway;
  const baseHome = (homeBaseHome + awayBaseHome) / 2;
  const baseAway = (homeBaseAway + awayBaseAway) / 2;
  const lambdaHome = Math.max(0.05, baseHome * Math.sqrt(hs.attack * as.defense));
  const lambdaAway = Math.max(0.05, baseAway * Math.sqrt(as.attack * hs.defense));

  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
    sampleSize: Math.min(hs.sample, as.sample),
    trainingMatches: homeDomestic.league === awayDomestic.league
      ? homeLeagueRows.length
      : homeLeagueRows.length + awayLeagueRows.length,
    homeDomesticLeague: homeDomestic.league,
    awayDomesticLeague: awayDomestic.league,
  };
}
