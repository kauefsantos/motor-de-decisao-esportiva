import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { getCornersExperimentalReport } from "@/lib/corners-experimental.functions";

export const Route = createFileRoute("/experimental/corners")({
  head: () => ({
    meta: [
      { title: "Modo experimental · Escanteios · Bet Value Engine" },
      {
        name: "description",
        content:
          "Diagnóstico experimental do modelo corners-baseline-v1 com partidas reais da temporada atual. Não validado para produção.",
      },
      { property: "og:title", content: "Modo experimental · Escanteios" },
      {
        property: "og:description",
        content: "Métricas out-of-sample experimentais do modelo de escanteios da temporada atual.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExperimentalCorners,
});

const num = (v: number | "INSUFFICIENT_SAMPLE", digits = 3) =>
  typeof v === "number" ? v.toFixed(digits) : "INSUFFICIENT_SAMPLE";

function ExperimentalCorners() {
  const fetchReport = useServerFn(getCornersExperimentalReport);
  const { data, isLoading } = useQuery({
    queryKey: ["corners-experimental"],
    queryFn: () => fetchReport(),
  });

  return (
    <main className="mx-auto max-w-[1100px] px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Modo experimental — escanteios
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Diagnóstico do modelo corners-baseline-v1 com partidas reais da temporada atual.
      </p>
      <div className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-warning">
        Modo experimental — não validado para produção
      </div>

      {isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando diagnóstico…
        </div>
      ) : !data ? (
        <p className="mt-8 text-muted-foreground">Nenhum diagnóstico disponível.</p>
      ) : (
        <div className="mt-6 space-y-8">
          <section className="grid gap-3 sm:grid-cols-3">
            <Info label="Temporada" value={data.season} />
            <Info label="Competições" value={data.competitions.join(", ") || "—"} />
            <Info label="prediction_at" value={data.predictionAt.slice(0, 19).replace("T", " ")} />
          </section>

          {data.outcome.status !== "EXPERIMENTAL_CURRENT_SEASON" ? (
            <section className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-semibold text-destructive">INSUFFICIENT_MODEL_TRAINING_DATA</p>
              <p className="mt-1 text-muted-foreground">
                {data.outcome.usableMatches} partida(s) utilizável(is); mínimo experimental de{" "}
                {data.outcome.requiredMatches}. Status de produção:{" "}
                {data.outcome.productionStatus}.
              </p>
            </section>
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-3">
                <Info label="Estado" value={data.outcome.status} />
                <Info label="Modelo" value={data.outcome.modelVersion} />
                <Info label="Produção" value={data.outcome.productionStatus} />
                <Info label="Jogos válidos" value={String(data.outcome.metrics.totalMatches)} />
                <Info label="Treino" value={String(data.outcome.metrics.trainMatches)} />
                <Info label="Teste" value={String(data.outcome.metrics.testMatches)} />
                <Info
                  label="Média real de escanteios"
                  value={data.outcome.metrics.meanActualCorners.toFixed(2)}
                />
                <Info
                  label="Média prevista"
                  value={data.outcome.metrics.meanPredictedCorners.toFixed(2)}
                />
                <Info label="Linha de avaliação" value={String(data.outcome.metrics.evalLine)} />
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Métricas out-of-sample (experimentais)
                </h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2">Métrica</th>
                      <th>Modelo</th>
                      <th>Baseline da competição</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-2 [&_tr]:border-t [&_tr]:border-border">
                    <tr>
                      <td>MAE</td>
                      <td>{data.outcome.metrics.modelMae.toFixed(3)}</td>
                      <td>{data.outcome.metrics.baselineMae.toFixed(3)}</td>
                    </tr>
                    <tr>
                      <td>RMSE</td>
                      <td>{data.outcome.metrics.modelRmse.toFixed(3)}</td>
                      <td>{data.outcome.metrics.baselineRmse.toFixed(3)}</td>
                    </tr>
                    <tr>
                      <td>Brier</td>
                      <td>{num(data.outcome.metrics.modelBrier)}</td>
                      <td>{num(data.outcome.metrics.baselineBrier)}</td>
                    </tr>
                    <tr>
                      <td>Log loss</td>
                      <td>{num(data.outcome.metrics.modelLogLoss)}</td>
                      <td>{num(data.outcome.metrics.baselineLogLoss)}</td>
                    </tr>
                    <tr>
                      <td>Calibração por faixas</td>
                      <td colSpan={2}>
                        {data.outcome.metrics.calibration === "INSUFFICIENT_SAMPLE"
                          ? "INSUFFICIENT_SAMPLE"
                          : `${data.outcome.metrics.calibration.length} faixas`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Previsões experimentais (não são apostas)
                </h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2">Data</th>
                      <th>Partida</th>
                      <th>λ total</th>
                      <th>P(over {data.outcome.metrics.evalLine})</th>
                      <th>Real</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-2 [&_tr]:border-t [&_tr]:border-border">
                    {data.outcome.predictions.map((p) => (
                      <tr key={`${p.date}-${p.homeTeam}-${p.awayTeam}`}>
                        <td>{p.date}</td>
                        <td>
                          {p.homeTeam} x {p.awayTeam}
                        </td>
                        <td>{p.lambdaTotal.toFixed(2)}</td>
                        <td>{(p.pOverEvalLine * 100).toFixed(1)}%</td>
                        <td>{p.actualTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Lineage das observações de escanteios
            </h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.lineage.map((l) => (
                <li key={`${l.source}-${l.definitionVersion}`}>
                  {l.source} · {l.definitionVersion} · {l.observations} observações
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
