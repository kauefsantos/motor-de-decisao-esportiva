import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  analyzeExperimentalCornersOdds,
  prepareExperimentalCornersRun,
} from "@/lib/experimental-corners-run.functions";

const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
const dec = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(2);

export function ExperimentalCornersPilot({ runId }: { runId: string }) {
  const prepare = useServerFn(prepareExperimentalCornersRun);
  const analyze = useServerFn(analyzeExperimentalCornersOdds);
  const [odds, setOdds] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof analyzeExperimentalCornersOdds>> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["experimental-corners-run", runId],
    queryFn: () => prepare({ data: { runId } }),
    staleTime: 5 * 60 * 1000,
  });

  const eligible = useMemo(
    () => (data?.candidates ?? []).filter((candidate) => candidate.gateMet),
    [data],
  );

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
      toast.error("Digite ao menos uma odd válida para um mercado experimental.");
      return;
    }

    setSubmitting(true);
    try {
      const evaluated = await analyze({ data: { runId, entries } });
      setResult(evaluated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no Motor 2 experimental.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel mt-8 overflow-hidden border-warning/50">
      <div className="border-b border-warning/30 bg-warning/10 px-6 py-4">
        <p className="label-eyebrow text-warning">Piloto experimental · CORNERS</p>
        <h2 className="mt-1 text-lg font-semibold">Temporada atual</h2>
        <p className="mt-1 text-sm font-semibold text-warning">
          MODELO EXPERIMENTAL — NÃO VALIDADO PARA PRODUÇÃO
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Produção permanece bloqueada como MODEL_NOT_PRODUCTION_VALIDATED. As odds abaixo são avaliadas apenas no piloto.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando previsões experimentais…
        </div>
      ) : eligible.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          <p>Nenhum mercado experimental de escanteios atingiu o gate de 65% nesta run.</p>
          {(data?.issues ?? []).length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
              {data!.issues.slice(0, 12).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="label-eyebrow px-6 py-3">Jogo</th>
                  <th className="label-eyebrow px-6 py-3">Mercado</th>
                  <th className="label-eyebrow px-6 py-3">Prob. exp.</th>
                  <th className="label-eyebrow px-6 py-3">Fair odd exp.</th>
                  <th className="label-eyebrow px-6 py-3">Amostra</th>
                  <th className="label-eyebrow w-36 px-6 py-3">Odd bet365</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((candidate) => (
                  <tr key={candidate.predictionId} className="border-b border-border/60">
                    <td className="px-6 py-4">
                      <div>{candidate.matchLabel}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{candidate.competition}</div>
                    </td>
                    <td className="px-6 py-4">{candidate.marketLabel}</td>
                    <td className="num px-6 py-4">{pct(candidate.probabilityExperimental)}</td>
                    <td className="num px-6 py-4">{dec(candidate.fairOddExperimental)}</td>
                    <td className="num px-6 py-4">
                      {candidate.sampleSize} time · {candidate.trainingMatches} liga
                    </td>
                    <td className="px-6 py-4">
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
                        aria-label={`Odd experimental para ${candidate.marketLabel}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-6">
            <Button onClick={() => void evaluate()} disabled={submitting}>
              {submitting ? "Calculando…" : "ANALISAR ODDS — PILOTO EXPERIMENTAL"}
            </Button>
          </div>
        </>
      )}

      {result && (
        <div className="border-t border-border p-6">
          <p className="label-eyebrow">Resultado do Motor 2 experimental</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2">Mercado</th>
                  <th>Odd</th>
                  <th>Fair odd</th>
                  <th>Odd mín. EV 2%</th>
                  <th>Edge</th>
                  <th>EV</th>
                  <th>Decisão</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_tr]:border-t [&_tr]:border-border">
                {result.evaluations.map((evaluation) => (
                  <tr key={evaluation.predictionId}>
                    <td>{evaluation.marketLabel}</td>
                    <td className="num">{dec(evaluation.odd)}</td>
                    <td className="num">{dec(evaluation.fairOdd)}</td>
                    <td className="num">{dec(evaluation.minOddTarget)}</td>
                    <td className="num">{pct(evaluation.edgeCons)}</td>
                    <td className="num">{pct(evaluation.evCons, 2)}</td>
                    <td>
                      <span className="font-medium">
                        {evaluation.selected ? "SELEÇÃO EXPERIMENTAL" : evaluation.valueStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs font-semibold text-warning">
            {result.modelStatus} · produção: {result.productionStatus}
          </p>
        </div>
      )}
    </section>
  );
}
