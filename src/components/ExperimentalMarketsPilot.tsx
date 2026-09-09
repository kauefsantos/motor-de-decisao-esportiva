import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRun } from "@/lib/analysis.functions";
import { collectAutomaticBet365Odds } from "@/lib/auto-bet365-odds.functions";
import {
  analyzeExperimentalMarketsOdds,
  prepareExperimentalMarketsRun,
} from "@/lib/experimental-markets-run.functions";

const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

const FAMILY_ORDER = [
  "CORNERS",
  "GOALS",
  "TEAM_GOALS",
  "1X2",
  "DOUBLE_CHANCE",
  "BTTS",
] as const;

const FAMILY_LABELS: Record<string, string> = {
  CORNERS: "Escanteios",
  GOALS: "Gols",
  TEAM_GOALS: "Gols por time",
  "1X2": "Resultado",
  DOUBLE_CHANCE: "Dupla chance",
  BTTS: "Ambas marcam",
};

type AutoQuote = {
  predictionId: string;
  status: "MATCHED" | "LINE_MISMATCH" | "UNSUPPORTED" | "NO_PRICE" | "SOURCE_UNAVAILABLE";
  odd: number | null;
  offeredLine: number | null;
  stage: "closing" | "opening" | null;
  reason: string;
};

function selectionLimitForDate(isoDate: string | null | undefined) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

export function ExperimentalMarketsPilot({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const prepare = useServerFn(prepareExperimentalMarketsRun);
  const analyze = useServerFn(analyzeExperimentalMarketsOdds);
  const collectAutoOdds = useServerFn(collectAutomaticBet365Odds);
  const fetchRun = useServerFn(getRun);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [autoOddsLoading, setAutoOddsLoading] = useState(false);
  const [autoQuotes, setAutoQuotes] = useState<Record<string, AutoQuote>>({});
  const [autoSummary, setAutoSummary] = useState<{
    matched: number;
    lineMismatch: number;
    unsupported: number;
    noPrice: number;
    sourceUnavailable: number;
  } | null>(null);
  const autoStartedForRun = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["experimental-markets-run", runId],
    queryFn: () => prepare({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: runData } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
  });

  const eligible = useMemo(
    () => (data?.candidates ?? []).filter((candidate) => candidate.gateMet),
    [data],
  );

  useEffect(() => {
    if (eligible.length === 0 || autoStartedForRun.current === runId) return;
    autoStartedForRun.current = runId;
    let cancelled = false;

    async function runAutomaticOdds() {
      setAutoOddsLoading(true);
      try {
        const result = await collectAutoOdds({ data: { runId } });
        if (cancelled) return;
        const byPrediction: Record<string, AutoQuote> = {};
        const automaticValues: Record<string, string> = {};
        for (const quote of result.quotes) {
          byPrediction[quote.predictionId] = quote as AutoQuote;
          if (quote.status === "MATCHED" && quote.odd !== null && quote.odd > 1) {
            automaticValues[quote.predictionId] = String(quote.odd);
          }
        }
        setAutoQuotes(byPrediction);
        setAutoSummary({
          matched: result.matched,
          lineMismatch: result.lineMismatch,
          unsupported: result.unsupported,
          noPrice: result.noPrice,
          sourceUnavailable: result.sourceUnavailable,
        });
        setOdds((current) => {
          const next = { ...current };
          for (const [predictionId, odd] of Object.entries(automaticValues)) {
            if (!next[predictionId]?.trim()) next[predictionId] = odd;
          }
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? `Não foi possível preencher as odds automaticamente: ${error.message}`
              : "Não foi possível preencher as odds automaticamente.",
          );
        }
      } finally {
        if (!cancelled) setAutoOddsLoading(false);
      }
    }

    void runAutomaticOdds();
    return () => {
      cancelled = true;
    };
  }, [collectAutoOdds, eligible.length, runId]);

  const groupedByMatch = useMemo(() => {
    const groups = new Map<
      string,
      { matchId: string; matchLabel: string; competition: string; rows: typeof eligible }
    >();

    for (const candidate of eligible) {
      const current = groups.get(candidate.matchId) ?? {
        matchId: candidate.matchId,
        matchLabel: candidate.matchLabel,
        competition: candidate.competition,
        rows: [],
      };
      current.rows.push(candidate);
      groups.set(candidate.matchId, current);
    }

    return [...groups.values()].map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => {
        const familyA = FAMILY_ORDER.indexOf(a.family as (typeof FAMILY_ORDER)[number]);
        const familyB = FAMILY_ORDER.indexOf(b.family as (typeof FAMILY_ORDER)[number]);
        if (familyA !== familyB) return familyA - familyB;
        return a.marketLabel.localeCompare(b.marketLabel, "pt-BR");
      }),
    }));
  }, [eligible]);

  async function evaluate() {
    const entries = eligible
      .map((candidate) => {
        const odd = Number((odds[candidate.predictionId] ?? "").replace(",", "."));
        return {
          predictionId: candidate.predictionId,
          odd,
          lineAtEntry: candidate.lineCanonical,
        };
      })
      .filter((entry) => Number.isFinite(entry.odd) && entry.odd > 1);

    if (entries.length === 0) {
      toast.error("Nenhuma odd válida disponível para comparar.");
      return;
    }

    setSubmitting(true);
    try {
      const evaluated = await analyze({ data: { runId, entries } });
      const targetDate =
        evaluated.targetDate ?? runData?.run?.target_date ?? data?.predictionAt?.slice(0, 10) ?? null;
      const selectionLimit = evaluated.selectionLimit ?? selectionLimitForDate(targetDate);
      const limitedSelections = evaluated.selections;
      const selectedIds = new Set(limitedSelections.map((selection) => selection.predictionId));
      const candidateByPrediction = new Map(
        eligible.map((candidate) => [candidate.predictionId, candidate]),
      );

      const enrichedEvaluations = evaluated.evaluations.map((evaluation) => {
        const candidate = candidateByPrediction.get(evaluation.predictionId);
        return {
          ...evaluation,
          selected: selectedIds.has(evaluation.predictionId),
          matchLabel: candidate?.matchLabel ?? "—",
          marketLabel: candidate?.marketLabel ?? evaluation.marketLabel,
          competition: candidate?.competition ?? "",
          family: candidate?.family ?? evaluation.family,
          modelVersion: candidate?.modelVersion ?? evaluation.modelVersion,
          sampleSize: candidate?.sampleSize ?? 0,
          trainingMatches: candidate?.trainingMatches ?? 0,
          lineCanonical: candidate?.lineCanonical ?? evaluation.lineCanonical ?? null,
        };
      });

      const payload = {
        runId,
        analyzedAt: new Date().toISOString(),
        targetDate,
        dayType: selectionLimit === 3 ? "WEEKEND" : "WEEKDAY",
        selectionLimit,
        modelStatus: evaluated.modelStatus,
        productionStatus: evaluated.productionStatus,
        evaluations: enrichedEvaluations,
        selectionOrder: limitedSelections.map((selection) => selection.predictionId),
      };

      localStorage.setItem(`experimental-result:${runId}`, JSON.stringify(payload));
      navigate({
        to: "/run/$runId/resultado",
        params: { runId },
        search: { mode: "experimental" },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível comparar as odds.");
      setSubmitting(false);
    }
  }

  const targetDate = runData?.run?.target_date ?? data?.predictionAt?.slice(0, 10) ?? null;
  const selectionLimit = selectionLimitForDate(targetDate);

  return (
    <section className="panel mt-8 overflow-hidden border-warning/50">
      <div className="border-b border-warning/30 bg-warning/10 px-6 py-4">
        <p className="label-eyebrow text-warning">Modo de teste</p>
        <h2 className="mt-1 text-lg font-semibold">Opções que passaram pela análise</h2>
        <p className="mt-1 text-sm font-semibold text-warning">
          Ainda estamos comparando as estimativas com resultados reais
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Primeiro o sistema calcula as chances sem olhar as odds. Só depois busca os preços da Bet365 e preenche automaticamente quando encontra a mesma opção disponível.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Quando o preço não está disponível ou a linha oferecida é diferente, você ainda pode preencher a odd manualmente. Nesta rodada podem ser escolhidas até {selectionLimit} opção(ões).
        </p>
        {autoOddsLoading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Buscando odds da Bet365…
          </div>
        ) : autoSummary ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Odds encontradas automaticamente: {autoSummary.matched}
            {autoSummary.lineMismatch > 0 ? ` · ${autoSummary.lineMismatch} com linha diferente` : ""}
            {autoSummary.unsupported > 0 ? ` · ${autoSummary.unsupported} precisam de preenchimento manual` : ""}
            {autoSummary.noPrice > 0 ? ` · ${autoSummary.noPrice} sem preço disponível` : ""}.
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando as opções…
        </div>
      ) : eligible.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          <p>Nenhuma opção atingiu a chance mínima exigida nesta rodada.</p>
          {(data?.issues ?? []).length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">Ver mais informações</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {data!.issues.slice(0, 16).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/70">
            {groupedByMatch.map((group) => (
              <article key={group.matchId} className="px-6 py-5">
                <div className="mb-4">
                  <h3 className="text-base font-semibold">{group.matchLabel}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{group.competition}</p>
                </div>

                <div className="overflow-x-auto rounded-md border border-border/70">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/20 text-left">
                        <th className="px-4 py-3 text-xs text-muted-foreground">Opção</th>
                        <th className="px-4 py-3 text-xs text-muted-foreground">Tipo</th>
                        <th className="px-4 py-3 text-xs text-muted-foreground">Chance calculada</th>
                        <th className="px-4 py-3 text-xs text-muted-foreground">Odd considerada justa</th>
                        <th className="px-4 py-3 text-xs text-muted-foreground">Jogos usados</th>
                        <th className="w-44 px-4 py-3 text-xs text-muted-foreground">Odd bet365</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((candidate) => {
                        const quote = autoQuotes[candidate.predictionId];
                        return (
                          <tr
                            key={candidate.predictionId}
                            className="border-b border-border/60 last:border-b-0"
                          >
                            <td className="px-4 py-3 font-medium">{candidate.marketLabel}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {FAMILY_LABELS[candidate.family] ?? candidate.family}
                            </td>
                            <td className="num px-4 py-3">
                              {pct(candidate.probabilityExperimental)}
                            </td>
                            <td className="num px-4 py-3">
                              {dec(candidate.fairOddExperimental)}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {candidate.sampleSize} do time · {candidate.trainingMatches} da liga
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                inputMode="decimal"
                                value={odds[candidate.predictionId] ?? ""}
                                onChange={(event) =>
                                  setOdds((current) => ({
                                    ...current,
                                    [candidate.predictionId]: event.target.value,
                                  }))
                                }
                                className="num w-28"
                                aria-label={`Odd bet365 para ${group.matchLabel} — ${candidate.marketLabel}`}
                              />
                              {quote?.status === "MATCHED" ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">Preenchida automaticamente</p>
                              ) : quote?.status === "LINE_MISMATCH" ? (
                                <p className="mt-1 max-w-40 text-[10px] text-muted-foreground">
                                  A Bet365 oferece a linha {quote.offeredLine ?? "—"}; confira e preencha manualmente se quiser.
                                </p>
                              ) : quote?.status === "UNSUPPORTED" ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">Preenchimento manual</p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>

          <div className="border-t border-border p-6">
            <Button onClick={() => void evaluate()} disabled={submitting || autoOddsLoading}>
              {submitting ? "Comparando…" : autoOddsLoading ? "Buscando odds…" : "COMPARAR ODDS"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
