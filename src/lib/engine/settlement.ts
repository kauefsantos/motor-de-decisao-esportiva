// Utilitários determinísticos de settlement asiático + normalização de linha.
// Puro, sem I/O, testável isoladamente.

import type { AsianOutcomeProbabilities } from "./types";

export class AmbiguousLineError extends Error {
  constructor(label: string) {
    super(`AMBIGUOUS_LINE: "${label}"`);
    this.name = "AmbiguousLineError";
  }
}

const NUM = /^-?\d+(?:\.\d+)?$/;

/**
 * Normaliza um rótulo de linha para valor canônico.
 * Aceita "2.5", "-0.5", "8,8.5" (split) e "5.5,6" (split) -> média das adjacentes.
 * Rejeita rótulos ambíguos (adjacentes não separadas por exatamente 0.5, vazio, texto).
 */
export function canonicalLine(label: string): number {
  const raw = (label ?? "").trim().replace(/\s/g, "");
  if (!raw) throw new AmbiguousLineError(label);

  const parts = raw.split(/[,/]/).filter(Boolean);
  if (parts.length === 1) {
    if (!NUM.test(parts[0]!)) throw new AmbiguousLineError(label);
    const v = Number(parts[0]);
    // linhas válidas são múltiplos de 0.25
    if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) throw new AmbiguousLineError(label);
    return v;
  }
  if (parts.length === 2) {
    if (!NUM.test(parts[0]!) || !NUM.test(parts[1]!)) throw new AmbiguousLineError(label);
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (Math.abs(Math.abs(a - b) - 0.5) > 1e-9) throw new AmbiguousLineError(label);
    return (a + b) / 2;
  }
  throw new AmbiguousLineError(label);
}

/** true quando a linha divide o stake entre duas adjacentes (.25 / .75). */
export function isSplitLine(line: number): boolean {
  const frac = Math.abs(line % 1);
  return Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
}

export function splitComponents(line: number): [number, number] {
  if (!isSplitLine(line)) return [line, line];
  return [line - 0.25, line + 0.25];
}

type CountDistribution = Map<number, number>;

/** Soma de probabilidade de contagens > x, = x e < x. */
function partition(dist: CountDistribution, x: number) {
  let above = 0;
  let equal = 0;
  let below = 0;
  for (const [k, p] of dist) {
    if (k > x + 1e-9) above += p;
    else if (k < x - 1e-9) below += p;
    else equal += p;
  }
  return { above, equal, below };
}

/**
 * Decompõe um contrato asiático (totais OVER/UNDER de contagem inteira) nos
 * cinco resultados de settlement, preservando meias.
 */
export function asianOutcomes(
  dist: CountDistribution,
  lineCanonical: number,
  side: "OVER" | "UNDER",
): AsianOutcomeProbabilities {
  if (isSplitLine(lineCanonical)) {
    const [lo, hi] = splitComponents(lineCanonical);
    const a = asianOutcomes(dist, lo, side);
    const b = asianOutcomes(dist, hi, side);
    return combineHalves(a, b);
  }

  const { above, equal, below } = partition(dist, lineCanonical);
  const isInteger = Math.abs(lineCanonical - Math.round(lineCanonical)) < 1e-9;

  if (side === "OVER") {
    return {
      FULL_WIN: above,
      HALF_WIN: 0,
      PUSH: isInteger ? equal : 0,
      HALF_LOSS: 0,
      FULL_LOSS: below + (isInteger ? 0 : equal),
    };
  }
  return {
    FULL_WIN: below,
    HALF_WIN: 0,
    PUSH: isInteger ? equal : 0,
    HALF_LOSS: 0,
    FULL_LOSS: above + (isInteger ? 0 : equal),
  };
}

/** Metade do stake em cada linha adjacente. */
export function combineHalves(
  a: AsianOutcomeProbabilities,
  b: AsianOutcomeProbabilities,
): AsianOutcomeProbabilities {
  const out: AsianOutcomeProbabilities = {
    FULL_WIN: 0,
    HALF_WIN: 0,
    PUSH: 0,
    HALF_LOSS: 0,
    FULL_LOSS: 0,
  };
  // resultado por metade: cada combinação (resultado A, resultado B)
  const keys = ["FULL_WIN", "PUSH", "FULL_LOSS"] as const;
  for (const ka of keys) {
    for (const kb of keys) {
      const p = a[ka] * b[kb];
      if (p === 0) continue;
      const score = (val: (typeof keys)[number]) =>
        val === "FULL_WIN" ? 1 : val === "PUSH" ? 0 : -1;
      const s = (score(ka) + score(kb)) / 2; // -1, -0.5, 0, 0.5, 1
      if (s === 1) out.FULL_WIN += p;
      else if (s === 0.5) out.HALF_WIN += p;
      else if (s === 0) out.PUSH += p;
      else if (s === -0.5) out.HALF_LOSS += p;
      else out.FULL_LOSS += p;
    }
  }
  return out;
}

/** P(FULL_WIN) + P(HALF_WIN) — usado no gate-base do Motor 1. */
export function pProfit(o: AsianOutcomeProbabilities): number {
  return o.FULL_WIN + o.HALF_WIN;
}

export function wEff(o: AsianOutcomeProbabilities): number {
  return o.FULL_WIN + 0.5 * o.HALF_WIN;
}

export function lEff(o: AsianOutcomeProbabilities): number {
  return o.FULL_LOSS + 0.5 * o.HALF_LOSS;
}

export function asianEV(o: AsianOutcomeProbabilities, odd: number): number {
  return wEff(o) * (odd - 1) - lEff(o);
}

export function asianFairOdd(o: AsianOutcomeProbabilities): number | null {
  const w = wEff(o);
  if (w <= 0) return null;
  return 1 + lEff(o) / w;
}

/** Odd mínima para atingir um EV alvo (ex.: 0.02). */
export function asianMinOdd(o: AsianOutcomeProbabilities, target: number): number | null {
  const w = wEff(o);
  if (w <= 0) return null;
  return 1 + (target + lEff(o)) / w;
}
