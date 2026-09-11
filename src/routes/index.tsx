import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { parseCsv, type CsvParseResult } from "@/lib/csv";
import { createRun } from "@/lib/analysis.functions";
import { enqueueAnalysis } from "@/lib/background-analysis.functions";
import { setAnalysisNotificationTarget } from "@/lib/push.browser";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analisar jogos · Bet Value Engine V2.1.1" },
      {
        name: "description",
        content: "Envie os jogos da rodada e veja quais opções de aposta merecem ser conferidas antes de olhar as odds.",
      },
    ],
  }),
  component: UploadScreen,
});

function dateLabel(iso: string | null) {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function UploadScreen() {
  const navigate = useNavigate();
  const create = useServerFn(createRun);
  const enqueue = useServerFn(enqueueAnalysis);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 2_000_000) {
      toast.error("O arquivo passou de 2 MB.");
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    setFilename(file.name);
    setParsed(result);
    if (result.rows.length === 0) {
      toast.error(result.invalid[0]?.reason ?? "Não encontrei nenhuma partida válida nesse arquivo.");
    }
  }, []);

  async function processar() {
    if (!parsed || !filename || parsed.rows.length === 0 || !parsed.targetDate) return;
    setSubmitting(true);
    try {
      const res = await create({
        data: {
          filename,
          targetDate: parsed.targetDate,
          headers: parsed.headers,
          invalidCount: parsed.invalid.length,
          leagues: parsed.leagues,
          rows: parsed.rows,
        },
      });
      // Queue the server-side worker before navigation. Once this resolves, the
      // analysis no longer depends on the phone keeping the app in foreground.
      await enqueue({ data: { runId: res.runId } });

      // Notification setup is best-effort only and must never prevent a sports
      // analysis that has already been safely queued on the server.
      try {
        await setAnalysisNotificationTarget(res.runId);
      } catch (error) {
        console.warn("[Web Push] could not persist analysis target", error);
      }

      navigate({ to: "/run/$runId/processamento", params: { runId: res.runId } });
    } catch {
      toast.error("Não foi possível iniciar a análise. Tente novamente.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell stage="upload">
      <div data-testid="upload-screen" data-hydrated={ready ? "true" : "false"} className="mx-auto max-w-3xl">
        <p className="label-eyebrow">Etapa 1</p>
        <h1 className="page-heading mt-1.5">Analisar os jogos do dia</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:text-base">
          Envie o CSV da rodada. Calculamos as chances primeiro e comparamos as odds depois.
        </p>

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
          className={`panel mt-4 flex min-h-44 flex-col items-center justify-center gap-3 border-primary/15 bg-primary/[0.035] px-4 py-6 text-center transition-all sm:mt-6 sm:min-h-64 sm:gap-4 sm:px-8 sm:py-9 ${
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
          <Button className="min-h-12 w-full sm:w-auto sm:min-w-40" variant="outline" disabled={!ready} onClick={() => inputRef.current?.click()}>
            Escolher CSV
          </Button>
        </div>

        <CollapsiblePanel
          className="mt-3 sm:mt-4"
          title="Como funciona"
          description="Enviar jogos → calcular chances → comparar odds → ver sugestões"
        >
          <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <li><span className="font-medium text-foreground">1. Envie os jogos.</span> A data do CSV define quais partidas serão procuradas.</li>
            <li><span className="font-medium text-foreground">2. Calculamos as chances.</span> Só usamos informações anteriores ao jogo.</li>
            <li><span className="font-medium text-foreground">3. Comparamos as odds.</span> Quando possível, buscamos a bet365 automaticamente.</li>
            <li><span className="font-medium text-foreground">4. Sugerimos pouco.</span> Se o preço não compensar, não há sugestão.</li>
          </ol>
        </CollapsiblePanel>

        {parsed && (
          <section className="panel mt-4 overflow-hidden">
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                  <FileSpreadsheet className="size-5 text-accent" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Arquivo pronto</p>
                  <span className="block truncate font-medium">{filename}</span>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="metric-tile p-3"><dt className="text-[11px] text-muted-foreground">Data</dt><dd className="num mt-1 text-xl font-semibold">{dateLabel(parsed.targetDate)}</dd></div>
                <div className="metric-tile p-3"><dt className="text-[11px] text-muted-foreground">Partidas</dt><dd className="num mt-1 text-xl font-semibold">{parsed.rows.length}</dd></div>
                <div className="metric-tile p-3"><dt className="text-[11px] text-muted-foreground">Campeonatos</dt><dd className="num mt-1 text-xl font-semibold">{parsed.leagues.length}</dd></div>
                <div className="metric-tile p-3"><dt className="text-[11px] text-muted-foreground">Ignoradas</dt><dd className="num mt-1 text-xl font-semibold">{parsed.invalid.length}</dd></div>
              </dl>

              {(parsed.leagues.length > 0 || parsed.invalid.length > 0) && (
                <CollapsiblePanel
                  title="Ver detalhes do arquivo"
                  description="Campeonatos encontrados e linhas que não puderam ser usadas"
                >
                  {parsed.leagues.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {parsed.leagues.map((league) => (
                        <span key={league} className="rounded-md bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">{league}</span>
                      ))}
                    </div>
                  )}
                  {parsed.invalid.length > 0 && (
                    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium text-warning"><AlertTriangle className="size-4" /> Algumas linhas foram ignoradas</p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {parsed.invalid.slice(0, 8).map((item, index) => <li key={`${item.line}-${index}`}>linha {item.line}: {item.reason}</li>)}
                      </ul>
                    </div>
                  )}
                </CollapsiblePanel>
              )}

              <Button
                className="min-h-12 w-full"
                size="lg"
                data-testid="processar-jogos"
                disabled={!ready || parsed.rows.length === 0 || !parsed.targetDate || submitting}
                onClick={() => void processar()}
              >
                {submitting ? "Começando…" : "COMEÇAR ANÁLISE"}
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
