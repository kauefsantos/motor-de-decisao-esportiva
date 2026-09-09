import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { parseCsv, type CsvParseResult } from "@/lib/csv";
import { createRun } from "@/lib/analysis.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analisar jogos · Bet Value Engine V2.1.1" },
      {
        name: "description",
        content: "Envie os jogos da rodada e veja quais opções de aposta merecem ser conferidas antes de olhar as odds.",
      },
      { property: "og:title", content: "Analisar jogos · Bet Value Engine V2.1.1" },
      {
        property: "og:description",
        content: "O sistema organiza as informações, calcula as chances e só depois compara com as odds.",
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
      navigate({ to: "/run/$runId/processamento", params: { runId: res.runId } });
    } catch {
      toast.error("Não foi possível iniciar a análise. Tente novamente.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell stage="upload">
      <div data-testid="upload-screen" data-hydrated={ready ? "true" : "false"} className="contents">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section>
            <p className="label-eyebrow">Etapa 1</p>
            <h1 className="mt-2 text-4xl font-bold">Analisar os jogos do dia</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Envie o CSV da rodada. Primeiro calculamos as chances usando as informações disponíveis. As odds entram só depois.
            </p>

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
              className={`panel mt-8 flex flex-col items-center justify-center gap-4 px-8 py-16 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : ""
              }`}
            >
              <UploadCloud className="size-10 text-primary" aria-hidden />
              <div>
                <p className="font-medium">Arraste o CSV aqui</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  O arquivo precisa ter Data, Partida, Horário e Campeonato. Use uma única data em cada arquivo.
                </p>
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
              <Button variant="outline" disabled={!ready} onClick={() => inputRef.current?.click()}>
                Escolher CSV
              </Button>
            </div>

            {parsed && (
              <div className="panel mt-6 p-6">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="size-5 text-accent" aria-hidden />
                  <span className="font-medium">{filename}</span>
                </div>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="label-eyebrow">Data dos jogos</dt>
                    <dd className="num mt-1 text-2xl">{dateLabel(parsed.targetDate)}</dd>
                  </div>
                  <div>
                    <dt className="label-eyebrow">Partidas encontradas</dt>
                    <dd className="num mt-1 text-2xl">{parsed.rows.length}</dd>
                  </div>
                  <div>
                    <dt className="label-eyebrow">Campeonatos</dt>
                    <dd className="num mt-1 text-2xl">{parsed.leagues.length}</dd>
                  </div>
                  <div>
                    <dt className="label-eyebrow">Linhas ignoradas</dt>
                    <dd className="num mt-1 text-2xl">{parsed.invalid.length}</dd>
                  </div>
                </dl>

                {parsed.leagues.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {parsed.leagues.map((l) => (
                      <span
                        key={l}
                        className="rounded-md bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                )}

                {parsed.invalid.length > 0 && (
                  <div className="mt-5 rounded-md border border-warning/40 bg-warning/10 p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-warning">
                      <AlertTriangle className="size-4" aria-hidden /> Algumas linhas foram ignoradas
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {parsed.invalid.slice(0, 8).map((i, index) => (
                        <li key={`${i.line}-${index}`}>
                          linha {i.line}: {i.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button
                  className="mt-6 w-full"
                  size="lg"
                  data-testid="processar-jogos"
                  disabled={!ready || parsed.rows.length === 0 || !parsed.targetDate || submitting}
                  onClick={() => void processar()}
                >
                  {submitting ? "Começando…" : "COMEÇAR ANÁLISE"}
                  <ArrowRight className="ml-2 size-4" aria-hidden />
                </Button>
              </div>
            )}
          </section>

          <aside className="panel h-fit p-6">
            <p className="label-eyebrow">Como funciona</p>
            <ol className="mt-4 space-y-4 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1. Você envia os jogos.</span> A data do CSV define quais partidas serão procuradas.
              </li>
              <li>
                <span className="font-medium text-foreground">2. Calculamos as chances.</span> O sistema usa somente informações anteriores ao jogo e separa as opções que atendem aos critérios mínimos.
              </li>
              <li>
                <span className="font-medium text-foreground">3. As odds são comparadas.</span> Quando possível, o sistema busca a odd da bet365 automaticamente; você também pode preencher manualmente.
              </li>
              <li>
                <span className="font-medium text-foreground">4. O sistema sugere pouco.</span> Pode indicar duas, três ou nenhuma aposta. Se a odd não compensar, não sugere.
              </li>
            </ol>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}