import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RESULT_VALUES = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;
type TrackingResult = (typeof RESULT_VALUES)[number];
type BetStatus = "PROPOSED" | "OPEN" | "DECLINED" | "SETTLED";

type TrackingRow = {
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
};

type BankrollConfig = {
  id: string;
  start_date: string;
  initial_bankroll: number | string;
  max_stake_pct: number | string;
  fractional_kelly: number | string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function n(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clv(row: TrackingRow) {
  const entry = n(row.entry_odd);
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

function analytics(rows: TrackingRow[], config: BankrollConfig) {
  const initialBankroll = n(config.initial_bankroll);
  const settled = rows.filter((row) => isSettled(row.result));
  const decided = settled.filter((row) => row.result === "WIN" || row.result === "LOSS");
  const wins = decided.filter((row) => row.result === "WIN").length;
  const losses = decided.filter((row) => row.result === "LOSS").length;
  const totalStake = settled.reduce((sum, row) => sum + n(row.stake_brl), 0);
  const totalProfit = settled.reduce((sum, row) => sum + n(row.profit_brl), 0);
  const currentBankroll = initialBankroll + totalProfit;
  const openStake = rows
    .filter((row) => row.bet_status === "OPEN" && row.result === "PENDING")
    .reduce((sum, row) => sum + n(row.stake_brl), 0);
  const availableBankroll = Math.max(0, currentBankroll - openStake);
  const roi = totalStake > 0 ? totalProfit / totalStake : null;
  const hitRate = wins + losses > 0 ? wins / (wins + losses) : null;
  const avgPredicted = mean(decided.map((row) => n(row.model_probability)).filter((value) => value > 0));
  const clvValues = rows.map(clv).filter((value): value is number => value !== null);
  const avgClv = mean(clvValues);

  const orderedSettled = [...settled].sort((a, b) => {
    const da = a.settled_at ?? a.target_date ?? a.created_at;
    const db = b.settled_at ?? b.target_date ?? b.created_at;
    return da.localeCompare(db) || a.created_at.localeCompare(b.created_at);
  });
  let running = initialBankroll;
  let peak = initialBankroll;
  let maxDrawdown = 0;
  const bankrollSeries = [
    { date: config.start_date, bankroll: initialBankroll, label: "Início" },
    ...orderedSettled.map((row) => {
      running += n(row.profit_brl);
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
      const stake = familySettled.reduce((sum, row) => sum + n(row.stake_brl), 0);
      const profit = familySettled.reduce((sum, row) => sum + n(row.profit_brl), 0);
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
    { key: "65–69%", min: 0.65, max: 0.70 },
    { key: "70–74%", min: 0.70, max: 0.75 },
    { key: "75–79%", min: 0.75, max: 0.80 },
    { key: "80%+", min: 0.80, max: 1.001 },
  ];
  const calibration = buckets.map((bucket) => {
    const bucketRows = decided.filter((row) => {
      const probability = n(row.model_probability);
      return probability >= bucket.min && probability < bucket.max;
    });
    const bucketWins = bucketRows.filter((row) => row.result === "WIN").length;
    return {
      bucket: bucket.key,
      count: bucketRows.length,
      predicted: mean(bucketRows.map((row) => n(row.model_probability))),
      observed: bucketRows.length ? bucketWins / bucketRows.length : null,
    };
  });

  const sampleMessage =
    decided.length === 0
      ? "Ainda não há resultados fechados. O painel começa a ganhar valor a partir das primeiras apostas confirmadas."
      : decided.length < 30
        ? "Amostra inicial: acompanhe tendência, preço de fechamento e disciplina, sem concluir ainda que o modelo é lucrativo."
        : decided.length < 100
          ? "Amostra em formação: já dá para comparar mercados e calibração, mas ainda há bastante variância."
          : "Amostra mais informativa: continue avaliando retorno, calibração, preço de fechamento e estabilidade por mercado.";

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
      maxStakePct: n(config.max_stake_pct),
      fractionalKelly: n(config.fractional_kelly),
    },
    bankrollSeries,
    byFamily,
    calibration,
  };
}

export const getExperimentalAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await db();
  const rawDb = supabase as unknown as {
    from: (table: string) => any;
  };

  const [{ data: configData, error: configError }, { data: trackingData, error: trackingError }] =
    await Promise.all([
      rawDb
        .from("experimental_bankroll_config")
        .select("id,start_date,initial_bankroll,max_stake_pct,fractional_kelly")
        .eq("id", "main")
        .single(),
      rawDb
        .from("experimental_bet_tracking")
        .select("*")
        .order("target_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

  if (configError) throw new Error(`Falha ao carregar configuração do acompanhamento: ${configError.message}`);
  if (trackingError) throw new Error(`Falha ao carregar histórico experimental: ${trackingError.message}`);

  const config = configData as BankrollConfig;
  const allRows = (trackingData ?? []) as TrackingRow[];
  const rows = allRows.filter(
    (row) =>
      typeof row.target_date === "string" &&
      row.target_date >= config.start_date &&
      (row.bet_status === "OPEN" || row.bet_status === "SETTLED" || row.result !== "PENDING" || n(row.stake_brl) > 0),
  );
  return { rows, ...analytics(rows, config) };
});

const settleSchema = z.object({
  id: z.string().uuid(),
  result: z.enum(RESULT_VALUES),
  stakeBrl: z.number().finite().min(0).max(1_000_000).nullable(),
  closingOdd: z.number().finite().gt(1).lt(1000).nullable(),
  notes: z.string().max(500).nullable().optional(),
});

export const updateExperimentalTracking = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => settleSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const rawDb = supabase as unknown as { from: (table: string) => any };
    const { data: row, error: fetchError } = await rawDb
      .from("experimental_bet_tracking")
      .select("id,entry_odd,bet_status")
      .eq("id", data.id)
      .single();
    if (fetchError || !row) {
      throw new Error(`Não foi possível localizar a seleção: ${fetchError?.message ?? "registro ausente"}`);
    }

    const stake = data.stakeBrl ?? null;
    let profitBrl: number | null = null;
    let profitUnits: number | null = null;
    let settledAt: string | null = null;
    let betStatus: BetStatus = row.bet_status as BetStatus;
    if (data.result !== "PENDING") {
      if (stake === null || !(stake > 0)) {
        throw new Error("Informe o valor realmente usado antes de fechar o resultado.");
      }
      const entryOdd = n(row.entry_odd);
      profitUnits = data.result === "WIN" ? entryOdd - 1 : data.result === "LOSS" ? -1 : 0;
      profitBrl = stake * profitUnits;
      settledAt = new Date().toISOString();
      betStatus = "SETTLED";
    } else if (stake !== null && stake > 0) {
      betStatus = "OPEN";
    }

    const { error } = await rawDb
      .from("experimental_bet_tracking")
      .update({
        stake_brl: stake,
        closing_odd: data.closingOdd,
        result: data.result,
        bet_status: betStatus,
        profit_units: profitUnits,
        profit_brl: profitBrl,
        notes: data.notes ?? null,
        settled_at: settledAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(`Falha ao atualizar o histórico: ${error.message}`);

    return { ok: true };
  });
