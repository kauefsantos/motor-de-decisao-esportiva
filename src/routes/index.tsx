import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Clock3, FileSpreadsheet, UploadCloud, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { parseCsv, type CsvParseResult } from "@/lib/csv";
import { createAnalysisDraft } from "@/lib/analysis-draft.functions";
import { getHomeSummary } from "@/lib/home-summary.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analisar jogos · Bet Value Engine V2.1.1" },
      {
        name: "description",
        content: "Envie os jogos da rodada, valide as partidas e veja quais opções de aposta merecem ser conferidas antes de olhar as odds.",
      },
    ],
  }),
  component: UploadScreen,
});

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
  if (status === "RUNNING") return "Preparando análise";
  if (status === "READY_FOR_ODDS") return "Pronta para conferir e escolher";
  if (status === "COMPLETED") return "Concluída";
  return "Em andamento";
}

function ResumeRunButton({ run, compact = false }: { run: any; compact?: boolean }) {
  const size = compact ? "sm" : "default";
  const variant = compact ? "outline" : "default";
  const className = compact ? undefined : "min-h-11 w-full sm:w-auto";

  if (run.selection_finalized_at) {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <Link to="/run/$runId/resultado" params={{ runId: run.id }} search={{ mode: "experimental" }}>Abrir resultado</Link>
      </Button>
    );
  }
  if (run.status === "RUNNING") {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <Link to="/run/$runId/processamento" params={{ runId: run.id }}>Continuar</Link>
      </Button>
    );
  }
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link to="/run/$runId/oportunidades" params={{ runId: run.id }}>Continuar</Link>
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
      toast.error(result.invalid[0]?.reason ?? "Não encontrei nenhuma partida válida nesse arquivo.");
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
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar a validação. Tente novamente.");
      setSubmitting(false);
    }
  }

  const summary = summaryQuery.data;
  const primaryPending = summary?.pendingDraft ?? summary?.resumableRun ?? null;

  return (
    <AppShell stage="upload">
      <div data-testid="upload-screen" data-hydrated={ready ? "true" : "false"} className="mx-auto max-w-4xl">
        <p className="label-eyebrow">Etapa 1 de 4 · enviar e validar</p>
        <h1 className="page-heading mt-1.5">O que precisa da sua atenção?</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:text-base">
          Continue uma análise que já começou, registre resultados pendentes ou envie uma nova rodada.
        </p>

        {summary && (
          <section className="panel mt-5 overflow-hidden" aria-label="Agora">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <p className="label-eyebrow">Agora</p>
            </div>
            <div className="divide-y divide-border/60">
              {primaryPending ? (
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div>
                    <p className="text-sm font-medium">Você tem uma análise para continuar</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {summary.pendingDraft
                        ? `Rodada ${dateLabel(summary.pendingDraft.target_date)} · validação pendente`
                        : `Rodada ${dateLabel(summary.resumableRun?.target_date)} · ${runStatusLabel(summary.resumableRun?.status ?? "")}`}
                    </p>
                  </div>
                  {summary.pendingDraft ? (
                    <Button asChild className="min-h-11 w-full sm:w-auto">
                      <Link to="/draft/$draftId/validacao" params={{ draftId: summary.pendingDraft.id }}>Continuar análise</Link>
                    </Button>
                  ) : (
                    <ResumeRunButton run={summary.resumableRun} />
                  )}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground sm:p-5">Nenhuma análise precisa ser retomada agora.</div>
              )}

              <div className="grid sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:divide-border/60">
                <Link to="/open-bets" className="flex min-h-20 items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/20">
                  <span><span className="block text-xs text-muted-foreground">Resultados para informar</span><strong className="num mt-1 block text-xl">{summary.openBetsCount}</strong></span>
                  <Clock3 className="size-5 text-muted-foreground" aria-hidden />
                </Link>
                {summary.proposedCount > 0 && summary.proposedRunId ? (
                  <Link
                    to="/run/$runId/resultado"
                    params={{ runId: summary.proposedRunId }}
                    search={{ mode: "experimental" }}
                    className="flex min-h-20 items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/20"
                  >
                    <span><span className="block text-xs text-muted-foreground">Sugestões para registrar</span><strong className="num mt-1 block text-xl">{summary.proposedCount}</strong></span>
                    <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <div className="flex min-h-20 items-center justify-between gap-3 p-4">
                    <span><span className="block text-xs text-muted-foreground">Sugestões para registrar</span><strong className="num mt-1 block text-xl">0</strong></span>
                    <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
                  </div>
                )}
                <div className="flex min-h-20 items-center justify-between gap-3 p-4">
                  <span><span className="block text-xs text-muted-foreground">Saldo disponível</span><strong className="num mt-1 block text-lg">{money(summary.availableBankroll)}</strong></span>
                  <WalletCards className="size-5 text-muted-foreground" aria-hidden />
                </div>
              </div>
            </div>
          </section>
        )}

        {summaryQuery.isError && (
          <div className="mt-4 rounded-xl border border-warning/25 bg-warning/8 p-3 text-sm text-muted-foreground">
            O resumo não pôde ser atualizado agora. Você ainda pode iniciar uma nova análise normalmente.
          </div>
        )}

        <div className="mt-7 flex items-end justify-between gap-3">
          <div>
            <p className="label-eyebrow">Nova análise</p>
            <h2 className="mt-1 text-xl font-semibold">Enviar os jogos da rodada</h2>
          </div>
        </div>

        <PushNotificationControl />

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
          className={`panel mt-4 flex min-h-44 flex-col items-center justify-center gap-3 border-primary/15 bg-primary/[0.035] px-4 py-6 text-center transition-all sm:min-h-56 sm:gap-4 sm:px-8 sm:py-8 ${
            dragging ? "border-primary bg-primary/10 ring-1 ring-primary/30" : ""
          }`}
        >
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/15 sm:size-14">
            <UploadCloud className="size-6 text-primary sm:size-7" aria-hidden />
          </div>
          <div>
            <p className="font-medium sm:hidden">Escolha o CSV dos jogos</p>
            <p className="hidden font-medium sm:block">Arraste o CSV aqui</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">Data, Partida, Horário e Campeonato · uma data por arquivo</p>
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
            Escolher CSV
          </Button>
        </div>

        {parsed && (
          <section className="panel mt-4 overflow-hidden">
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                  <FileSpreadsheet className="size-5 text-accent" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Arquivo pronto para validação</p>
                  <span className="block truncate font-medium">{filename}</span>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border/60 py-4 sm:grid-cols-4">
                <div><dt className="text-[11px] text-muted-foreground">Data</dt><dd className="num mt-1 text-lg font-semibold">{dateLabel(parsed.targetDate)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Partidas</dt><dd className="num mt-1 text-lg font-semibold">{parsed.rows.length}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Campeonatos</dt><dd className="num mt-1 text-lg font-semibold">{parsed.leagues.length}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Ignoradas</dt><dd className={`num mt-1 text-lg font-semibold ${parsed.invalid.length > 0 ? "text-warning" : ""}`}>{parsed.invalid.length}</dd></div>
              </dl>

              {parsed.invalid.length > 0 && (
                <div className="rounded-xl border border-warning/30 bg-warning/8 p-3" role="alert">
                  <p className="flex items-center gap-2 text-sm font-medium text-warning">
                    <AlertTriangle className="size-4" aria-hidden /> {parsed.invalid.length} linha{parsed.invalid.length === 1 ? "" : "s"} não {parsed.invalid.length === 1 ? "será" : "serão"} analisada{parsed.invalid.length === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Confira os motivos antes de continuar. As outras partidas podem seguir normalmente.</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium text-foreground">Ver linhas ignoradas</summary>
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {parsed.invalid.slice(0, 12).map((item, index) => <li key={`${item.line}-${index}`}>Linha {item.line}: {item.reason}</li>)}
                    </ul>
                  </details>
                </div>
              )}

              {parsed.leagues.length > 0 && (
                <CollapsiblePanel title="Campeonatos encontrados" description="Confira rapidamente o que foi reconhecido" meta={parsed.leagues.length}>
                  <div className="flex flex-wrap gap-2">
                    {parsed.leagues.map((league) => (
                      <span key={league} className="rounded-md bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">{league}</span>
                    ))}
                  </div>
                </CollapsiblePanel>
              )}

              <Button
                className="min-h-12 w-full"
                size="lg"
                data-testid="processar-jogos"
                disabled={!ready || parsed.rows.length === 0 || !parsed.targetDate || !clientRequestId || submitting}
                onClick={() => void processar()}
              >
                {submitting ? "Preparando validação…" : "VALIDAR PARTIDAS"}
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          </section>
        )}

        <CollapsiblePanel
          className="mt-4"
          title="Como funciona"
          description="Quatro etapas simples, do CSV ao registro"
        >
          <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <li><span className="font-medium text-foreground">1. Enviar e validar.</span> Conferimos os jogos e pedimos correção apenas quando necessário.</li>
            <li><span className="font-medium text-foreground">2. Preparar.</span> O sistema organiza os dados e calcula as chances.</li>
            <li><span className="font-medium text-foreground">3. Conferir e escolher.</span> A odd real é comparada com a análise e você escolhe até 3 opções para a rodada.</li>
            <li><span className="font-medium text-foreground">4. Revisar e registrar.</span> Você revisa as escolhas e registra apenas as apostas que realmente fez.</li>
          </ol>
        </CollapsiblePanel>

        {summary?.recentRuns?.length > 0 && (
          <CollapsiblePanel className="mt-4" title="Análises recentes" description="Retome ou consulte as últimas rodadas" meta={summary.recentRuns.length}>
            <ul className="divide-y divide-border">
              {summary.recentRuns.map((run: any) => (
                <li key={run.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Rodada {dateLabel(run.target_date)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{runStatusLabel(run.status)} · {run.matches_total ?? 0} jogo(s)</p>
                  </div>
                  <ResumeRunButton run={run} compact />
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        )}
      </div>
    </AppShell>
  );
}
