import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Clock3, FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { createAnalysisDraft } from "@/lib/analysis-draft.functions";
import { parseCsv, type CsvParseResult } from "@/lib/csv";
import { getHomeSummary } from "@/lib/home-summary.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analisar jogos · Bet Value" },
      {
        name: "description",
        content: "Envie os jogos, acompanhe a análise e veja apenas as oportunidades que passarem pelos filtros.",
      },
    ],
  }),
  component: UploadScreen,
});

type HomeSummary = Awaited<ReturnType<typeof getHomeSummary>>;
type RecentRun = HomeSummary["recentRuns"][number];

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function runStatusLabel(status: string) {
  if (status === "RUNNING") return "Analisando";
  if (status === "READY_FOR_ODDS") return "Pronta para conferir";
  if (status === "COMPLETED") return "Concluída";
  return "Em andamento";
}

function ResumeRunButton({ run, compact = false }: { run: RecentRun | null | undefined; compact?: boolean }) {
  if (!run) return null;
  const buttonProps = compact
    ? { size: "sm" as const, variant: "outline" as const }
    : { className: "min-h-11 w-full sm:w-auto" };

  if (run.selection_finalized_at) {
    return (
      <Button asChild {...buttonProps}>
        <Link to="/run/$runId/resultado" params={{ runId: run.id }} search={{ mode: "experimental" }}>Ver resultado</Link>
      </Button>
    );
  }
  if (run.status === "RUNNING") {
    return (
      <Button asChild {...buttonProps}>
        <Link to="/run/$runId/processamento" params={{ runId: run.id }}>Acompanhar</Link>
      </Button>
    );
  }
  return (
    <Button asChild {...buttonProps}>
      <Link to="/run/$runId/oportunidades" params={{ runId: run.id }}>Ver análise</Link>
    </Button>
  );
}

function UploadScreen() {
  const navigate = useNavigate();
  const createDraft = useServerFn(createAnalysisDraft);
  const loadSummary = useServerFn(getHomeSummary);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const summaryQuery = useQuery({
    queryKey: ["home-summary"],
    queryFn: () => loadSummary(),
    staleTime: 30_000,
  });

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 2_000_000) {
      toast.error("O arquivo passou de 2 MB. Escolha um CSV menor para continuar.");
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    setFilename(file.name);
    setParsed(result);
    setClientRequestId(crypto.randomUUID());
    if (result.rows.length === 0) {
      toast.error(result.invalid[0]?.reason ?? "Não encontrei nenhum jogo válido nesse arquivo.");
    }
  }, []);

  async function processar() {
    if (!parsed || !filename || parsed.rows.length === 0 || !parsed.targetDate || !clientRequestId) return;
    setSubmitting(true);
    try {
      const res = await createDraft({
        data: {
          clientRequestId,
          filename,
          targetDate: parsed.targetDate,
          headers: parsed.headers,
          invalidCount: parsed.invalid.length,
          leagues: parsed.leagues,
          rows: parsed.rows.map((row) => ({
            partida: row.partida,
            horario: row.horario,
            campeonato: row.campeonato,
            targetDate: row.data,
          })),
        },
      });
      navigate({ to: "/draft/$draftId/validacao", params: { draftId: res.data.draftId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar os jogos. Tente novamente.");
      setSubmitting(false);
    }
  }

  const summary = summaryQuery.data;
  const primaryPending = summary?.pendingDraft ?? summary?.resumableRun ?? null;
  const recentRuns = summary?.recentRuns ?? [];
  const hasSecondaryAction = Boolean(summary && (summary.openBetsCount > 0 || summary.proposedCount > 0));

  return (
    <AppShell stage="upload">
      <div data-testid="upload-screen" data-hydrated={ready ? "true" : "false"} className="mx-auto max-w-3xl">
        <div>
          <p className="label-eyebrow">Análises</p>
          <h1 className="page-heading mt-1.5">O que você quer analisar?</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Envie os jogos da rodada. O sistema faz a análise e mostra somente o que realmente passar pelos filtros.
          </p>
        </div>

        {summary && primaryPending && (
          <section className="panel mt-5 border-primary/20 bg-primary/[0.035] p-4 sm:p-5" aria-label="Próxima ação">
            <p className="label-eyebrow">Continue de onde parou</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">
                  {summary.pendingDraft ? "Jogos aguardando conferência" : `Rodada ${dateLabel(summary.resumableRun?.target_date)}`}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {summary.pendingDraft
                    ? `Rodada ${dateLabel(summary.pendingDraft.target_date)} · confira os jogos antes de analisar`
                    : runStatusLabel(summary.resumableRun?.status ?? "")}
                </p>
              </div>
              {summary.pendingDraft ? (
                <Button asChild className="min-h-11 w-full sm:w-auto">
                  <Link to="/draft/$draftId/validacao" params={{ draftId: summary.pendingDraft.id }}>Conferir jogos</Link>
                </Button>
              ) : (
                <ResumeRunButton run={summary.resumableRun} />
              )}
            </div>
          </section>
        )}

        {summary && hasSecondaryAction && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {summary.openBetsCount > 0 && (
              <Link to="/open-bets" className="panel flex min-h-20 items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/20">
                <span><span className="block text-xs text-muted-foreground">Resultados para informar</span><strong className="num mt-1 block text-xl">{summary.openBetsCount}</strong></span>
                <Clock3 className="size-5 text-muted-foreground" aria-hidden />
              </Link>
            )}
            {summary.proposedCount > 0 && summary.proposedRunId && (
              <Link
                to="/run/$runId/resultado"
                params={{ runId: summary.proposedRunId }}
                search={{ mode: "experimental" }}
                className="panel flex min-h-20 items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/20"
                data-testid="proposed-run-link"
              >
                <span><span className="block text-xs text-muted-foreground">Escolhas para registrar</span><strong className="num mt-1 block text-xl">{summary.proposedCount}</strong></span>
                <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
              </Link>
            )}
          </div>
        )}

        {summaryQuery.isError && (
          <div className="mt-4 rounded-xl border border-warning/25 bg-warning/8 p-3 text-sm text-muted-foreground">
            O resumo não pôde ser atualizado agora. Você ainda pode iniciar uma nova análise normalmente.
          </div>
        )}

        <section className="mt-7">
          <div>
            <p className="label-eyebrow">Nova análise</p>
            <h2 className="mt-1 text-xl font-semibold">Enviar jogos da rodada</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use um CSV com Data, Partida, Horário e Campeonato.</p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={`panel mt-4 flex min-h-44 flex-col items-center justify-center gap-3 border-primary/15 bg-primary/[0.025] px-4 py-6 text-center transition-all sm:min-h-52 sm:px-8 ${
              dragging ? "border-primary bg-primary/10 ring-1 ring-primary/30" : ""
            }`}
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <UploadCloud className="size-6 text-primary" aria-hidden />
            </div>
            <div>
              <p className="font-medium">Escolha o CSV dos jogos</p>
              <p className="mt-1 text-xs text-muted-foreground sm:hidden">Toque abaixo para selecionar</p>
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block">ou arraste o arquivo para esta área</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="csv-input"
              disabled={!ready}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button className="min-h-12 w-full sm:w-auto sm:min-w-40" disabled={!ready} onClick={() => inputRef.current?.click()}>
              Escolher arquivo
            </Button>
          </div>
        </section>

        {parsed && (
          <section className="panel mt-4 overflow-hidden">
            <div className="p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10"><FileSpreadsheet className="size-5 text-accent" aria-hidden /></div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Arquivo carregado</p>
                  <span className="block truncate font-medium">{filename}</span>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-secondary/30 p-3"><dt className="text-[11px] text-muted-foreground">Rodada</dt><dd className="num mt-1 font-semibold">{dateLabel(parsed.targetDate)}</dd></div>
                <div className="rounded-xl bg-secondary/30 p-3"><dt className="text-[11px] text-muted-foreground">Jogos</dt><dd className="num mt-1 font-semibold">{parsed.rows.length}</dd></div>
                <div className="rounded-xl bg-secondary/30 p-3"><dt className="text-[11px] text-muted-foreground">Ignorados</dt><dd className={`num mt-1 font-semibold ${parsed.invalid.length > 0 ? "text-warning" : ""}`}>{parsed.invalid.length}</dd></div>
              </dl>

              {parsed.invalid.length > 0 && (
                <div className="mt-4 rounded-xl border border-warning/30 bg-warning/8 p-3" role="alert">
                  <p className="flex items-center gap-2 text-sm font-medium text-warning"><AlertTriangle className="size-4" aria-hidden /> Alguns jogos serão ignorados</p>
                  <p className="mt-1 text-xs text-muted-foreground">Os outros {parsed.rows.length} jogos podem seguir normalmente.</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium text-foreground">Ver o que foi ignorado</summary>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {parsed.invalid.slice(0, 12).map((item, index) => <li key={`${item.line}-${index}`}>Linha {item.line}: {item.reason}</li>)}
                    </ul>
                  </details>
                </div>
              )}

              {parsed.leagues.length > 0 && (
                <details className="mt-4 rounded-xl border border-border/60 px-3">
                  <summary className="touch-target flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium">Campeonatos encontrados <span className="num text-xs text-muted-foreground">{parsed.leagues.length}</span></summary>
                  <div className="flex flex-wrap gap-2 border-t border-border/60 py-3">
                    {parsed.leagues.map((league) => <span key={league} className="rounded-md bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">{league}</span>)}
                  </div>
                </details>
              )}

              <Button
                className="mt-4 min-h-12 w-full"
                size="lg"
                data-testid="processar-jogos"
                disabled={!ready || parsed.rows.length === 0 || !parsed.targetDate || !clientRequestId || submitting}
                onClick={() => void processar()}
              >
                {submitting ? "Preparando jogos…" : "Conferir jogos"}
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          </section>
        )}

        <details className="mt-4 rounded-xl border border-border/60 bg-secondary/10 px-4">
          <summary className="touch-target flex min-h-12 cursor-pointer list-none items-center text-sm font-medium">Avisos no celular</summary>
          <div className="border-t border-border/60 pb-4"><PushNotificationControl /></div>
        </details>

        <CollapsiblePanel className="mt-4" title="Como funciona" description="Do arquivo ao resultado, sem termos técnicos">
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li><span className="font-medium text-foreground">1. Confira os jogos.</span> O sistema identifica as partidas e só pede ajuda se algo estiver ambíguo.</li>
            <li><span className="font-medium text-foreground">2. Aguarde a análise.</span> Os dados são organizados e as chances são calculadas em segundo plano.</li>
            <li><span className="font-medium text-foreground">3. Veja o resultado.</span> Só aparecem opções que passarem por todos os filtros. Zero opções também é um resultado válido.</li>
            <li><span className="font-medium text-foreground">4. Registre o que realmente fez.</span> O sistema não aposta por você.</li>
          </ol>
        </CollapsiblePanel>

        {(recentRuns.length > 0 || summary?.availableBankroll !== null) && (
          <CollapsiblePanel className="mt-4" title="Histórico e saldo" description="Informações que não precisam ocupar a tela principal">
            {summary?.availableBankroll !== null && (
              <div className="mb-4 rounded-xl bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">Saldo disponível</p>
                <p className="num mt-1 text-lg font-semibold">{money(summary?.availableBankroll)}</p>
              </div>
            )}
            {recentRuns.length > 0 && (
              <ul className="divide-y divide-border">
                {recentRuns.map((run) => (
                  <li key={run.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Rodada {dateLabel(run.target_date)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{runStatusLabel(run.status)} · {run.matches_total ?? 0} jogo(s)</p>
                    </div>
                    <ResumeRunButton run={run} compact />
                  </li>
                ))}
              </ul>
            )}
          </CollapsiblePanel>
        )}
      </div>
    </AppShell>
  );
}
