import { supabase } from "@/integrations/supabase/client";

export type CanonicalBankrollSnapshot = {
  generatedAt: string;
  bankroll: {
    initial: number;
    equity: number;
    available: number;
    locked: number;
    settledProfit: number;
    maxStakePct: number;
    fractionalKelly: number;
    minStakeBrl: number;
  };
  tracking: {
    openBetsCount: number;
    proposedCount: number;
    settledProfit: number;
    lockedStake: number;
  };
  config: {
    id: string;
    startDate: string;
    updatedAt: string;
  };
};

export async function getCanonicalBankrollSnapshot(): Promise<CanonicalBankrollSnapshot> {
  const { data, error } = await supabase.functions.invoke<CanonicalBankrollSnapshot>("bankroll-dashboard", {
    body: {},
  });

  if (error || !data) {
    throw new Error("Não foi possível sincronizar a banca entre acompanhamento e desempenho.");
  }

  return data;
}
