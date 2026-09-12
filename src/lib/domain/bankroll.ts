export type BankrollTrackingRow = {
  id: string;
  run_id: string;
  prediction_id: string;
  target_date: string | null;
  match_label: string;
  competition: string | null;
  market_family: string;
  market_label: string;
  model_probability: number | string;
  entry_odd: number | string;
  expected_value: number | string | null;
  edge: number | string | null;
  stake_brl: number | string | null;
  profit_brl: number | string | null;
  result: string;
  bet_status: "PROPOSED" | "OPEN" | "DECLINED" | "SETTLED";
  selection_rank: number | null;
  accepted_at: string | null;
};

export function bankrollNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function floorCents(value: number) {
  return Math.max(0, Math.floor(value * 100 + 1e-9) / 100);
}

export function operationalMaxStake(bankroll: number, maxStakePct: number, minStakeBrl: number) {
  if (!(bankroll >= minStakeBrl) || !(minStakeBrl > 0)) return 0;
  const proportional = floorCents(bankroll * maxStakePct);
  return Math.min(bankroll, Math.max(minStakeBrl, proportional));
}

export function buildStakeSuggestion(
  row: BankrollTrackingRow,
  bankroll: number,
  maxStakePct: number,
  fractionalKelly: number,
  minStakeBrl: number,
) {
  const odd = bankrollNumber(row.entry_odd);
  const expectedValue = Math.max(0, bankrollNumber(row.expected_value));
  const maxAllowed = operationalMaxStake(bankroll, maxStakePct, minStakeBrl);
  if (maxAllowed <= 0 || expectedValue <= 0) {
    return { suggestedStake: 0, maxAllowedStake: maxAllowed, minimumStake: minStakeBrl };
  }

  const edgeFraction = odd > 1 ? expectedValue / (odd - 1) : 0;
  const kellyStake = Math.max(0, edgeFraction * fractionalKelly * bankroll);
  const modelStake = floorCents(Math.min(maxAllowed, kellyStake));
  const suggestedStake = modelStake > 0 && modelStake < minStakeBrl
    ? Math.min(maxAllowed, minStakeBrl)
    : modelStake;

  return {
    suggestedStake,
    maxAllowedStake: maxAllowed,
    minimumStake: minStakeBrl,
  };
}
