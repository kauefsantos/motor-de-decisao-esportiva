import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  correctAnalysisDraft,
  finalizeAnalysisDraft,
  getAnalysisDraft,
  validateAnalysisDraft,
} from "@/lib/analysis-draft.functions";
import { setAnalysisNotificationTarget } from "@/lib/push.browser";

export const Route = createFileRoute("/draft/$draftId/validacao")({
  head: () => ({ meta: [{ title: "Validar partidas · Bet Value Engine" }] }),
  component: DraftValidationScreen,
});

type EditableField = "partida" | "horario" | "campeonato" | "target_date";

type DraftGame = {
  id: string;
  ordinal: number;
  partida: string;
  horario: string;
  campeonato: string;
  target_date: string | null;
  validation_status: string | null;
  editable_fields: EditableField[] | null;
  validation_errors: Array<{ field: string; code: string; message: string }> | null;
  suggestions: Array<Record<string, unknown>> | null;
  resolved_home_team: string | null;
  resolved_away_team: string | null;
  resolved_competition: string | null;
  resolved_kickoff: string | null;
};

function fieldLabel(field: EditableField) {
  if (field === "partida") return "Partida";
  if (field === "horario") return "Horário";
  if (field === "campeonato") return "Campeonato";
  return "Data";
}

function currentValue(game: DraftGame, field: EditableField) {
  if (field === "target_date") return game.target_date?.slice(0, 10) ?? "";
  return String(game[field] ?? "");
}

function finalizeKey(draftId: string) {
  const storageKey = `analysis-finalize-key:${draftId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function DraftValidationScreen() {
  const { draftId } = Route.useParams();
  const navigate = useNavigate();
  const loadDraft = useServerFn(getAnalysisDraft);
  const validateDraft = useServerFn(validateAnalysisDraft);
  const correctDraft = useServerFn(correctAnalysisDraft);
  const finalizeDraft = useServerFn(finalizeAnalysisDraft);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const query = useQuery({
    queryKey: ["analysis-draft-validation", draftId],
    queryFn: async () => {
      let current = (await loadDraft({ data: { draftId } })).data;
      const status = String(current.draft.status ?? "");
      if (status !== "READY" && status !== "NEEDS_CORRECTION") {
        await validateDraft({ data: { draftId } });
        current = (await loadDraft({ data: { draftId } })).data;
      }
      return current;
    },
    staleTime: Infinity,
    retry: 1,
  });

  const games = useMemo(() => (query.data?.games ?? []) as DraftGame[], [query.data?.games]);
  const invalidGames = games.filter((game) => game.validation_status !== "VALID");
  const ready = games.length > 0 && invalidGames.length === 0 && query.data?.draft.status === "READY";

  useEffect(() => {
    if (games.length === 0) return;
    setValues((current) => {
      const next = { ...current };
      for (const game of games) {
        for (const field of game.editable_fields ?? []) {
          const key = `${game.id}:${field}`;
          if (!(key in next)) next[key] = currentValue(game, field);
        }
      }
      return next;
    });
  }, [games]);

  async function applyCorrections() {
    const corrections = invalidGames.flatMap((game) =>
      (game.editable_fields ?? []).flatMap((field) => {
        const key = `${game.id}:${field}`;
        const value = (values[key] ?? "").trim();
        return value ? [{ gameId: game.id, field, value }] : [];
      }),
    );
    if (corrections.length === 0) {
      toast.error("Preencha ao menos um dos campos marcados para correção.");
      return;
    }

    setSaving(true);
    try {
      await correctDraft({ data: { draftId, corrections } });
      await validateDraft({ data: { draftId } });
      await query.refetch();
      toast.success("Correções validadas novamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível validar as correções.");
    } finally {
      setSaving(false);
    }
  }

  async function startAnalysis() {
    setFinalizing(true);
    try {
      const result = await finalizeDraft({
        data: { draftId, idempotencyKey: finalizeKey(draftId) },
      });
      const runId = result.data.runId;
      try {
        await setAnalysisNotificationTarget(runId);
      } catch (error) {
        console.warn("[Web Push] could not persist analysis target", error);
      }
      navigate({ to: "/run/$runId/processamento", params: { runId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ainda existem partidas que precisam ser corrigidas.");
      setFinalizing(false);
    }
  }

  return (
    <AppShell stage="upload">
      <div className="mx-auto max-w-4xl">
        <p className="label-eyebrow">Etapa 1 · validação</p>
        <h1 className="page-heading mt-2">Conferir partidas antes de processar</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          O servidor compara cada jogo com a fonte esportiva. Quando houver dúvida, somente os campos identificados como corrigíveis ficam editáveis.
        </p>

        <PushNotificationControl />

        {query.isLoading && (
          <div className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Validando partidas e horários…
          </div>
        )}

        {query.isError && (
          <div className="panel mt-5 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível concluir a validação</p>
                <p className="mt-1 text-sm text-muted-foreground">Nenhuma análise foi criada em duplicidade. Você pode tentar carregar a validação novamente.</p>
                <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && ready && (
          <div className="panel mt-5 border-success/25 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div>
                <p className="font-medium">Todas as partidas foram identificadas</p>
                <p className="mt-1 text-sm text-muted-foreground">A análise só será criada quando você continuar. A finalização é idempotente e já coloca o processamento na fila do servidor.</p>
              </div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && games.length > 0 && (
          <div className="mt-5 grid gap-3">
            {games.map((game) => {
              const editable = game.editable_fields ?? [];
              const valid = game.validation_status === "VALID";
              return (
                <article key={game.id} className={`panel p-4 sm:p-5 ${valid ? "border-success/20" : "border-warning/30"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Jogo {game.ordinal + 1}</p>
                      <h2 className="mt-1 font-semibold">{game.partida}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{game.campeonato} · {game.target_date?.slice(0, 10) ?? "—"} · {game.horario}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${valid ? "bg-success/10 text-success" : "bg-warning/12 text-warning"}`}>
                      {valid ? "Validado" : "Precisa conferir"}
                    </span>
                  </div>

                  {valid ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Correspondência: {game.resolved_home_team ?? "—"} x {game.resolved_away_team ?? "—"} · {game.resolved_competition ?? game.campeonato}
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 rounded-lg border border-warning/25 bg-warning/8 p-3">
                        {(game.validation_errors ?? []).map((item, index) => (
                          <p key={`${item.code}-${index}`} className="text-xs text-warning">{item.message}</p>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {editable.map((field) => {
                          const key = `${game.id}:${field}`;
                          return (
                            <label key={field} className="text-xs text-muted-foreground">
                              {fieldLabel(field)}
                              <Input
                                className="mt-1"
                                value={values[key] ?? currentValue(game, field)}
                                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                              />
                            </label>
                          );
                        })}
                      </div>
                      {(game.suggestions ?? []).length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium">Sugestões encontradas</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(game.suggestions ?? []).slice(0, 5).map((suggestion, index) => (
                              <Button
                                key={index}
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const field = editable.includes("target_date") && typeof suggestion.date === "string"
                                    ? "target_date"
                                    : editable.includes("partida") && typeof suggestion.partida === "string"
                                      ? "partida"
                                      : null;
                                  if (!field) return;
                                  const value = field === "target_date" ? String(suggestion.date) : String(suggestion.partida);
                                  setValues((current) => ({ ...current, [`${game.id}:${field}`]: value }));
                                }}
                              >
                                {String(suggestion.partida ?? suggestion.label ?? suggestion.date ?? `Sugestão ${index + 1}`)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {!query.isLoading && !query.isError && invalidGames.length > 0 && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-12" onClick={() => void applyCorrections()} disabled={saving}>
              {saving ? "Validando novamente…" : "VALIDAR CORREÇÕES"}
            </Button>
            <Button variant="outline" className="min-h-12" onClick={() => navigate({ to: "/" })}>Enviar outro CSV</Button>
          </div>
        )}

        {!query.isLoading && !query.isError && ready && (
          <Button className="mt-5 min-h-12 w-full sm:w-auto" onClick={() => void startAnalysis()} disabled={finalizing}>
            {finalizing ? "Criando análise…" : "CONTINUAR PARA O PROCESSAMENTO"}
          </Button>
        )}
      </div>
    </AppShell>
  );
}
