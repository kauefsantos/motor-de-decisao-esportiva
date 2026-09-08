// Elo v1 — força relativa determinística, sem odds como feature.
// O rating armazenado é neutro; o mando entra apenas na expectativa usada para
// atualizar o Elo após partidas encerradas. O ajuste dos lambdas preserva a
// expectativa total de gols e só redistribui a participação entre os times.

export const ELO_VERSION = "elo-v1";
export const ELO_INITIAL_RATING = 1500;
export const ELO_K = 20;
export const ELO_DEFAULT_HOME_ADVANTAGE = 60;
export const ELO_GOAL_SHARE_WEIGHT = 0.2;
export const ELO_MODEL_VERSION = `${ELO_VERSION}-w020`;
export const LEAGUE_ELO_MODEL_VERSION = "league-elo-v1";
export const HIERARCHICAL_ELO_MODEL_VERSION = "elo-v2-hierarchical";

export interface EloUpdateInput {
  homeRating: number;
  awayRating: number;
  homeGoals: number;
  awayGoals: number;
  homeAdvantage?: number;
  k?: number;
}

export interface EloUpdateResult {
  expectedHome: number;
  actualHome: number;
  delta: number;
  homeAfter: number;
  awayAfter: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function eloExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function actualHomeScore(homeGoals: number, awayGoals: number): number {
  if (homeGoals > awayGoals) return 1;
  if (homeGoals < awayGoals) return 0;
  return 0.5;
}

/**
 * Estima o mando usando somente partidas anteriores. Antes de 30 jogos usa um
 * fallback conservador de 60 pontos. Nunca permite vantagem negativa e limita
 * o efeito a 120 pontos para evitar que amostras ruins dominem o rating.
 */
export function homeAdvantageFromPast(homeScoreSum: number, matches: number): number {
  if (matches < 30) return ELO_DEFAULT_HOME_ADVANTAGE;
  const p = clamp(homeScoreSum / matches, 0.5, 0.665);
  const points = 400 * Math.log10(p / (1 - p));
  return clamp(points, 0, 120);
}

export function updateElo(input: EloUpdateInput): EloUpdateResult {
  const homeAdvantage = input.homeAdvantage ?? ELO_DEFAULT_HOME_ADVANTAGE;
  const k = input.k ?? ELO_K;
  const expectedHome = eloExpectedScore(input.homeRating + homeAdvantage, input.awayRating);
  const actualHome = actualHomeScore(input.homeGoals, input.awayGoals);
  const delta = k * (actualHome - expectedHome);
  return {
    expectedHome,
    actualHome,
    delta,
    homeAfter: input.homeRating + delta,
    awayAfter: input.awayRating - delta,
  };
}

export interface EloGoalAdjustment {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  baseHomeShare: number;
  adjustedHomeShare: number;
  eloExpectedNeutralHome: number;
  eloDelta: number;
}

/**
 * Elo é uma feature auxiliar do modelo de gols, não um segundo motor.
 * - não adiciona bônus de mando aqui (o modelo de gols já separa casa/fora);
 * - preserva lambdaTotal, portanto não cria artificialmente mais/menos gols;
 * - limita a diferença Elo a ±300 e aplica peso 0,20 enquanto a feature segue
 *   experimental, reduzindo risco de dupla contagem com ataque/defesa.
 */
export function applyEloToGoalLambdas(
  lambdaHome: number,
  lambdaAway: number,
  homeRating: number,
  awayRating: number,
): EloGoalAdjustment {
  const total = Math.max(0.1, lambdaHome + lambdaAway);
  const baseHomeShare = clamp(lambdaHome / total, 0.05, 0.95);
  const eloDelta = clamp(homeRating - awayRating, -300, 300);
  const eloExpectedNeutralHome = eloExpectedScore(eloDelta, 0);
  const tilt = (eloExpectedNeutralHome - 0.5) * ELO_GOAL_SHARE_WEIGHT;
  const adjustedHomeShare = clamp(baseHomeShare + tilt, 0.08, 0.92);

  return {
    lambdaHome: total * adjustedHomeShare,
    lambdaAway: total * (1 - adjustedHomeShare),
    lambdaTotal: total,
    baseHomeShare,
    adjustedHomeShare,
    eloExpectedNeutralHome,
    eloDelta,
  };
}
