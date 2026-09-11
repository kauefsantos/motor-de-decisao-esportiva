import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BET_STATUSES = ["PROPOSED", "OPEN", "DECLINED", "SETTLED"] as const;

type TrackingRow = {
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
  bet_status: (typeof BET_STATUSES)[number];
  selection_rank: number | null;
  accepted_at: string | null;
};

type Config = {
  initial_bankroll: number | string;
  max_stake_pct: number | string;
  fractional_kelly: number | string;
  min_stake_brl: number | string;
};

type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>;
};

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floorCents(value: number) {
  return Math.max(0, Math.floor(value * 100 + 1e-9) / 100);
}

function operationalMaxStake(bankroll: number, maxStakePct: number, minStakeBrl: number) {
  if (!(bankroll >= minStakeBrl) || !(minStakeBrl > 0)) return 0;
  const proportional = floorCents(bankroll * maxStakePct);
  return Math.min(bankroll, Math.max(minStakeBrl, proportional));
}

async function bankrollSnapshot(rawDb: Db) {
  const [{ data: config, error: configError }, { data: rows, error: rowsError }] = await Promise.all([
    rawDb
      .from("experimental_bankroll_config")
      .select("initial_bankroll,max_stake_pct,fractional_kelly,min_stake_brl")
      .eq("id", "main")
      .single(),
    rawDb
      .from("experimental_bet_tracking")
      .select("bet_status,stake_brl,profit_brl,result"),
  ]);
  if (configError || !config) throw new Error(`Não foi possível carregar a banca: ${configError?.message ?? "configuração ausente"}`);
  if (rowsError) throw new Error(`Não foi possível calcular o saldo: ${rowsError.message}`);

  const cfg = config as Config;
  const all = (rows ?? []) as Array<Pick<TrackingRow, "bet_status" | "stake_brl" | "profit_brl" | "result">>;
  const settledProfit = all
    .filter((row) => row.bet_status === "SETTLED" || row.result !== "PENDING")
    .reduce((sum, row) => sum + num(row.profit_brl), 0);
  const locked = all
    .filter((row) => row.bet_status === "OPEN" && row.result === "PENDING")
    .reduce((sum, row) => sum + num(row.stake_brl), 0);
  const equity = num(cfg.initial_bankroll) + settledProfit;
  const available = Math.max(0, equity - locked);
  const maxStakePct = num(cfg.max_stake_pct, 0.05);
  const fractionalKelly = num(cfg.fractional_kelly, 0.25);
  const minStakeBrl = num(cfg.min_stake_brl, 0.5);
  return {
    equity,
    available,
    locked,
    maxStakePct,
    fractionalKelly,
    minStakeBrl,
    maxAllowedStake: operationalMaxStake(available, maxStakePct, minStakeBrl),
  };
}

function suggestion(
  row: TrackingRow,
  bankroll: number,
  maxStakePct: number,
  fractionalKelly: number,
  minStakeBrl: number,
) {
  const odd = num(row.entry_odd);
  const ev = Math.max(0, num(row.expected_value));
  const maxAllowed = operationalMaxStake(bankroll, maxStakePct, minStakeBrl);
  if (maxAllowed <= 0 || ev <= 0) {
    return { suggestedStake: 0, maxAllowedStake: maxAllowed, minimumStake: minStakeBrl };
  }

  const edgeFraction = odd > 1 ? ev / (odd - 1) : 0;
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

const planSchema = z.object({ runId: z.string().uuid() });

export const getExperimentalBetPlan = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => planSchema.parse(input))
  .handler(async ({ data }) => {
    const rawDb = await db();
    const snapshot = await bankrollSnapshot(rawDb);
    const { data: rows, error } = await rawDb
      .from("experimental_bet_tracking")
      .select("*")
      .eq("run_id", data.runId)
      .order("selection_rank", { ascending: true, nullsFirst: false })
      .order("expected_value", { ascending: false });
    if (error) throw new Error(`Não foi possível carregar as seleções: ${error.message}`);

    const all = (rows ?? []) as TrackingRow[];
    const proposed = all.filter((row) => row.bet_status === "PROPOSED");
    const open = all.filter((row) => row.bet_status === "OPEN");
    const declined = all.filter((row) => row.bet_status === "DECLINED");
    const next = proposed[0] ?? null;
    const stakePlan = next
      ? suggestion(
          next,
          snapshot.available,
          snapshot.maxStakePct,
          snapshot.fractionalKelly,
          snapshot.minStakeBrl,
        )
      : null;

    return {
      bankroll: snapshot,
      nextProposal: next && stakePlan ? { ...next, ...stakePlan } : null,
      proposedCount: proposed.length,
      openCount: open.length,
      declinedCount: declined.length,
      all,
    };
  });

const confirmSchema = z.object({
  id: z.string().uuid(),
  stakeBrl: z.number().finite().min(0).max(1_000_000),
});

export const confirmExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => confirmSchema.parse(input))
  .handler(async ({ data }) => {
    const rawDb = await db();
    const { data: rpcRows, error } = await rawDb.rpc("confirm_experimental_bet_atomic", {
      p_id: data.id,
      p_stake_brl: floorCents(data.stakeBrl),
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row) throw new Error("A confirmação da banca não retornou resultado.");

    return {
      status: String(row.status) === "DECLINED" ? ("DECLINED" as const) : ("OPEN" as const),
      stakeBrl: num(row.stake_brl),
      availableAfter: num(row.available_after),
      maxAllowed: num(row.max_allowed),
      minimumStake: num(row.minimum_stake, 0.5),
    };
  });

export const getOpenExperimentalBets = createServerFn({ method: "GET" }).handler(async () => {
  const rawDb = await db();
  const snapshot = await bankrollSnapshot(rawDb);
  const { data: rows, error } = await rawDb
    .from("experimental_bet_tracking")
    .select("*")
    .eq("bet_status", "OPEN")
    .eq("result", "PENDING")
    .order("target_date", { ascending: true })
    .order("accepted_at", { ascending: true });
  if (error) throw new Error(`Não foi possível carregar as apostas abertas: ${error.message}`);
  return { rows: (rows ?? []) as TrackingRow[], bankroll: snapshot };
});

const settleSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["WIN", "LOSS"]),
});

export const settleOpenExperimentalBet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => settleSchema.parse(input))
  .handler(async ({ data }) => {
    const rawDb = await db();
    const { data: rpcRows, error } = await rawDb.rpc("settle_experimental_bet_atomic", {
      p_id: data.id,
      p_outcome: data.outcome,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row) throw new Error("O fechamento da aposta não retornou resultado.");
    return { ok: true, profitBrl: num(row.profit_brl), profitUnits: num(row.profit_units) };
  });
