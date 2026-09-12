export const RESULT_VALUES = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;
export type TrackingResult = (typeof RESULT_VALUES)[number];
export type BetStatus = "PROPOSED" | "OPEN" | "DECLINED" | "SETTLED";
export type DecisionPolicyVersion = "decision-v1-legacy-pre-strict70" | "decision-v2-strict70";
export const CURRENT_DECISION_POLICY: DecisionPolicyVersion = "decision-v2-strict70";

export type TrackingRow = {
  id: string;
  run_id: string;
  match_id: string | null;
  prediction_id: string;
  target_date: string | null;
  match_label: string;
  competition: string | null;
  market_family: string;
  market: string;
  market_label: string;
  participant: string | null;
  side: string | null;
  line_canonical: number | string | null;
  model_version: string;
  model_status: string;
  model_probability: number | string;
  fair_odd: number | string | null;
  entry_odd: number | string;
  min_odd_target: number | string | null;
  edge: number | string | null;
  expected_value: number | string | null;
  closing_odd: number | string | null;
  result: TrackingResult;
  profit_units: number | string | null;
  stake_brl: number | string | null;
  profit_brl: number | string | null;
  notes: string | null;
  bet_status: BetStatus;
  selection_rank: number | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
  decision_policy_version: DecisionPolicyVersion;
};

export type BankrollConfig = {
  id: string;
  start_date: string;
  initial_bankroll: number | string;
  max_stake_pct: number | string;
  fractional_kelly: number | string;
};

export function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clv(row: TrackingRow) {
  const entry = toNumber(row.entry_odd);
  const close = nullableNumber(row.closing_odd);
  if (!(entry > 1) || close === null || !(close > 1)) return null;
  return entry / close - 1;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isSettled(result: TrackingResult) {
  return result !== "PENDING";
}

export function calculateExperimentalAnalytics(rows: TrackingRow[], config: BankrollConfig) {
  const initialBankroll = toNumber(config.initial_bankroll);
  const settled = rows.filter((row) => isSettled(row.result));
  const decided = settled.filter((row) => row.result === "WIN" || row.result === "LOSS");
  const wins = decided.filter((row) => row.result === "WIN").length;
  const losses = decided.filter((row) => row.result === "LOSS").length;
  const totalStake = settled.reduce((sum, row) => sum + toNumber(row.stake_brl), 0);
  const totalProfit = settled.reduce((sum, row) => sum + toNumber(row.profit_brl), 0);
  const currentBankroll = initialBankroll + totalProfit;
  const openStake = rows
    .filter((row) => row.bet_status === "OPEN" && row.result === "PENDING")
    .reduce((sum, row) => sum + toNumber(row.stake_brl), 0);
  const availableBankroll = Math.max(0, currentBankroll - openStake);
  const roi = totalStake > 0 ? totalProfit / totalStake : null;
  const hitRate = wins + losses > 0 ? wins / (wins + losses) : null;
  const avgPredicted = mean(decided.map((row) => toNumber(row.model_probability)).filter((value) => value > 0));
  const clvValues = rows.map(clv).filter((value): value is number => value !== null);
  const avgClv = mean(clvValues);

  const orderedSettled = [...settled].sort((a, b) => {
    const dateA = a.settled_at ?? a.target_date ?? a.created_at;
    const dateB = b.settled_at ?? b.target_date ?? b.created_at;
    return dateA.localeCompare(dateB) || a.created_at.localeCompare(b.created_at);
  });
  let running = initialBankroll;
  let peak = initialBankroll;
  let maxDrawdown = 0;
  const bankrollSeries = [
    { date: config.start_date, bankroll: initialBankroll, label: "Início" },
    ...orderedSettled.map((row) => {
      running += toNumber(row.profit_brl);
      peak = Math.max(peak, running);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - running) / peak);
      return {
        date: row.settled_at?.slice(0, 10) ?? row.target_date ?? row.created_at.slice(0, 10),
        bankroll: running,
        label: row.match_label,
      };
    }),
  ];

  const familyMap = new Map<string, TrackingRow[]>();
  for (const row of rows) {
    const group = familyMap.get(row.market_family) ?? [];
    group.push(row);
    familyMap.set(row.market_family, group);
  }
  const byFamily = [...familyMap.entries()]
    .map(([family, familyRows]) => {
      const familySettled = familyRows.filter((row) => isSettled(row.result));
      const familyDecided = familySettled.filter((row) => row.result === "WIN" || row.result === "LOSS");
      const familyWins = familyDecided.filter((row) => row.result === "WIN").length;
      const stake = familySettled.reduce((sum, row) => sum + toNumber(row.stake_brl), 0);
      const profit = familySettled.reduce((sum, row) => sum + toNumber(row.profit_brl), 0);
      const familyClv = familyRows.map(clv).filter((value): value is number => value !== null);
      return {
        family,
        selections: familyRows.length,
        settled: familySettled.length,
        stake,
        profit,
        roi: stake > 0 ? profit / stake : null,
        hitRate: familyDecided.length ? familyWins / familyDecided.length : null,
        avgClv: mean(familyClv),
      };
    })
    .sort((a, b) => b.selections - a.selections || a.family.localeCompare(b.family));

  const buckets = [
    { key: "70–74%", min: 0.70, max: 0.75 },
    { key: "75–79%", min: 0.75, max: 0.80 },
    { key: "80–84%", min: 0.80, max: 0.85 },
    { key: "85%+", min: 0.85, max: 1.001 },
  ];
  const calibration = buckets.map((bucket) => {
    const bucketRows = decided.filter((row) => {
      const probability = toNumber(row.model_probability);
      return probability > bucket.min || (bucket.min > 0.70 && probability >= bucket.min)
        ? probability < bucket.max
        : false;
    });
    const bucketWins = bucketRows.filter((row) => row.result === "WIN").length;
    return {
      bucket: bucket.key,
      count: bucketRows.length,
      predicted: mean(bucketRows.map((row) => toNumber(row.model_probability))),
      observed: bucketRows.length ? bucketWins / bucketRows.length : null,
    };
  });

  const sampleMessage =
    decided.length === 0
      ? "Ainda não há resultados fechados na política atual."
      : decided.length < 30
        ? "Amostra inicial da política atual: acompanhe tendência, preço de fechamento e disciplina, sem concluir ainda que o modelo é lucrativo."
        : decided.length < 100
          ? "Amostra em formação da política atual: já dá para comparar mercados e calibração, mas ainda há bastante variância."
          : "Amostra mais informativa da política atual: continue avaliando retorno, calibração, preço de fechamento e estabilidade por mercado.";

  return {
    summary: {
      initialBankroll,
      currentBankroll,
      availableBankroll,
      openStake,
      totalProfit,
      totalStake,
      roi,
      wins,
      losses,
      hitRate,
      avgPredicted,
      avgClv,
      maxDrawdown,
      selections: rows.length,
      settled: settled.length,
      pending: rows.filter((row) => row.bet_status === "OPEN" && row.result === "PENDING").length,
      withClosingOdd: clvValues.length,
      sampleMessage,
    },
    config: {
      startDate: config.start_date,
      initialBankroll,
      maxStakePct: toNumber(config.max_stake_pct),
      fractionalKelly: toNumber(config.fractional_kelly),
    },
    bankrollSeries,
    byFamily,
    calibration,
  };
}
