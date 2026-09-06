import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { parseCsv, type CsvParseResult } from "@/lib/csv";
import { createRun } from "@/lib/analysis.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Análise de Jogos · Bet Value Engine V2.1.1" },
      {
        name: "description",
        content:
          "Envie o CSV de partidas e encontre mercados de futebol com suporte estatístico antes de olhar as odds.",
      },
      { property: "og:title", content: "Análise de Jogos · Bet Value Engine V2.1.1" },
      {
        property: "og:description",
        content:
          "Motor quantitativo pré-jogo: mercados com suporte estatístico primeiro, preço e EV depois.",
      },
    ],
  }),
  component: UploadScreen,
});

function UploadScreen() {
  const navigate = useNavigate();
  const create = useServerFn(createRun);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 2_000_000) {
      toast.error("Arquivo acima de 2 MB.");
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    setFilename(file.name);
    setParsed(result);
    if (result.rows.length === 0) {
      toast.error("Nenhuma linha válida encontrada no CSV.");
    }
  }, []);

  async function processar() {
    if (!parsed || !filename || parsed.rows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await create({
        data: {
          filename,
          targetDate: new Date().toISOString().slice(0, 10),
          headers: parsed.headers,
          invalidCount: parsed.invalid.length,
          leagues: parsed.leagues,
          rows: parsed.rows,
        },
      });
      navigate({ to: "/run/$runId/processamento", params: { runId: res.runId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar a análise.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell stage="upload">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section>
          <p className="label-eyebrow">Etapa 1</p>
          <h1 className="mt-2 text-4xl font-bold">Análise de Jogos</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Envie o CSV e encontre mercados com suporte estatístico antes de olhar as odds.
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
              <p className="font-medium">Arraste o arquivo CSV aqui</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Colunas obrigatórias: Partida, Horário, Campeonato. Uma coluna de índice extra é
                aceita e ignorada.
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              Selecionar CSV
            </Button>
          </div>

          {parsed && (
            <div className="panel mt-6 p-6">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-5 text-accent" aria-hidden />
                <span className="font-medium">{filename}</span>
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="label-eyebrow">Partidas válidas</dt>
                  <dd className="num mt-1 text-2xl">{parsed.rows.length}</dd>
                </div>
                <div>
                  <dt className="label-eyebrow">Campeonatos</dt>
                  <dd className="num mt-1 text-2xl">{parsed.leagues.length}</dd>
                </div>
                <div>
                  <dt className="label-eyebrow">Linhas inválidas</dt>
                  <dd className="num mt-1 text-2xl">{parsed.invalid.length}</dd>
                </div>
              </dl>

              {parsed.leagues.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {parsed.leagues.map((l) => (
                    <span
                      key={l}
                      className="num rounded-md bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}

              {parsed.invalid.length > 0 && (
                <div className="mt-5 rounded-md border border-warning/40 bg-warning/10 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-warning">
                    <AlertTriangle className="size-4" aria-hidden /> Linhas descartadas
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {parsed.invalid.slice(0, 8).map((i) => (
                      <li key={i.line} className="num">
                        linha {i.line}: {i.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                className="mt-6 w-full"
                size="lg"
                disabled={parsed.rows.length === 0 || submitting}
                onClick={() => void processar()}
              >
                {submitting ? "Criando análise…" : "PROCESSAR JOGOS"}
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          )}
        </section>

        <aside className="panel h-fit p-6">
          <p className="label-eyebrow">Como o motor decide</p>
          <ol className="mt-4 space-y-4 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Motor 1 — Oportunidade.</span> Escolhe
              contratos com suporte quantitativo sem olhar preço. Gate-base: 65% em contratos
              binários e p_profit ≥ 65% em asiáticos.
            </li>
            <li>
              <span className="font-medium text-foreground">Você digita a odd</span> da bet365
              Brasil apenas para os contratos publicados.
            </li>
            <li>
              <span className="font-medium text-foreground">Motor 2 — Valor.</span> Calcula EV
              conservador e devolve de zero a no máximo três escolhas. Nunca força três.
            </li>
          </ol>
          <p className="mt-6 text-xs text-muted-foreground">
            Sem dados de fonte licenciada configurada, o motor bloqueia o mercado com motivo
            explícito em vez de estimar probabilidade.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
