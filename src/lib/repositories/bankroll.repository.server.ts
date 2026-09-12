import type { AdminDb } from "../admin-db";
import type { BankrollTrackingRow } from "../domain/bankroll";
import { callRuntimeRpc } from "./runtime-rpc.server";

export type BankrollMetricsRow = {
  current_equity: number | string | null;
  available_bankroll: number | string | null;
  locked_stake: number | string | null;
  max_stake_pct: number | string | null;
  fractional_kelly: number | string | null;
  min_stake_brl: number | string | null;
};

export type ConfirmBetRow = {
  status: string;
  stake_brl: number | string | null;
  available_after: number | string | null;
  max_allowed: number | string | null;
  minimum_stake: number | string | null;
};

export type SettleBetRow = {
  profit_brl: number | string | null;
  profit_units: number | string | null;
};

function first<T>(value: T[] | T | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function loadBankrollMetrics(db: AdminDb, userId: string) {
  const result = await callRuntimeRpc<BankrollMetricsRow[] | BankrollMetricsRow>(
    db,
    "get_owner_bankroll_metrics",
    { p_owner_id: userId },
  );
  return { row: first(result.data), error: result.error };
}

export async function loadOpenBets(db: AdminDb, userId: string) {
  return callRuntimeRpc<BankrollTrackingRow[]>(db, "get_owner_open_bets", { p_owner_id: userId });
}

export async function confirmBetAtomic(db: AdminDb, id: string, stakeBrl: number) {
  const result = await callRuntimeRpc<ConfirmBetRow[] | ConfirmBetRow>(
    db,
    "confirm_experimental_bet_atomic",
    { p_id: id, p_stake_brl: stakeBrl },
  );
  return { row: first(result.data), error: result.error };
}

export async function settleBetAtomic(db: AdminDb, id: string, outcome: "WIN" | "LOSS") {
  const result = await callRuntimeRpc<SettleBetRow[] | SettleBetRow>(
    db,
    "settle_experimental_bet_atomic",
    { p_id: id, p_outcome: outcome },
  );
  return { row: first(result.data), error: result.error };
}
