import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleOff, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { PushNotificationControl } from "@/components/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  correctAnalysisDraft,
  finalizeAnalysisDraft,
  getAnalysisDraft,
  setAnalysisDraftGameIgnored,
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
  ignored: boolean;
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

function fieldInputId(gameId: string, field: EditableField) {
  return `draft-field-${gameId}-${field}`;
}

function fieldErrorId(gameId: string, field: string, index: number) {
  return `draft-error-${gameId}-${field}-${index}`;
}

function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function kickoffLabel(iso: string | null | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
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
  const setGameIgnored = useServerFn(setAnalysisDraftGameIgnored);
  const finalizeDraft = useServerFn(finalizeAnalysisDraft);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingGameId, setTogglingGameId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const query = useQuery({
    queryKey: ["analysis-draft-validation", draftId],
    queryFn: async () => {
      let current = (await loadDraft({ data: { draftId } })).data;
      const status = String(current.draft.status ?? "");
      if (status === "FINALIZED" || status === "CANCELLED") return current;
      if (status !== "READY" && status !== "NEEDS_CORRECTION") {
        await validateDraft({ data: { draftId } });
        current = (await loadDraft({ data: { draftId } })).data;
      }
      return current;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  const games = useMemo(() => (query.data?.games ?? []) as DraftGame[], [query.data?.games]);
  const activeGames = games.filter((game) => !game.ignored);
  const ignoredCount = games.length - activeGames.length;
  const invalidGames = activeGames.filter((game) => game.validation_status !== "VALID");
  const validCount = activeGames.length - invalidGames.length;
  const draftStatus = String(query.data?.draft.status ?? "");
  const terminalDraft = draftStatus === "FINALIZED" || draftStatus === "CANCELLED";
  const finalRunId = typeof query.data?.draft.final_run_id === "string" ? query.data.draft.final_run_id : null;
  const ready = activeGames.length > 0 && invalidGames.length === 0 && draftStatus === "READY";

  useEffect(() => {
    if (!terminalDraft) return;
    if (draftStatus === "FINALIZED" && finalRunId) {
      navigate({ to: "/run/$runId/processamento", params: { runId: finalRunId }, replace: true });
      return;
    }
    navigate({ to: "/", replace: true });
  }, [draftStatus, finalRunId, navigate, terminalDraft]);

  useEffect(() => {
    if (games.length === 0) return;
    setValues((current) => {
      const next = { ...current };
      for (const game of games) {
        if (game.ignored) continue;
        for (const field of game.editable_fields ?? []) {
          const key = `${game.id}:${field}`;
          if (!(key in next)) next[key] = currentValue(game, field);
        }
      }
      return next;
    });
  }, [games]);

  function focusFirstInvalid(targetGames: DraftGame[]) {
    const firstGame = targetGames.find((game) => !game.ignored && game.validation_status !== "VALID" && (game.editable_fields?.length ?? 0) > 0);
    const firstField = firstGame?.editable_fields?.[0];
    if (!firstGame || !firstField) return;
    requestAnimationFrame(() => document.getElementById(fieldInputId(firstGame.id, firstField))?.focus());
  }

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
      focusFirstInvalid(invalidGames);
      return;
    }

    setSaving(true);
    try {
      await correctDraft({ data: { draftId, corrections } });
      await validateDraft({ data: { draftId } });
      const refreshed = await query.refetch();
      const refreshedGames = (refreshed.data?.games ?? []) as DraftGame[];
      const remainingInvalid = refreshedGames.filter((game) => !game.ignored && game.validation_status !== "VALID");
      if (remainingInvalid.length > 0) focusFirstInvalid(remainingInvalid);
      toast.success("Correções conferidas. A lista foi atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível validar as correções.");
      focusFirstInvalid(invalidGames);
    } finally {
      setSaving(false);
    }
  }

  async function toggleIgnored(game: DraftGame, ignored: boolean) {
    setTogglingGameId(game.id);
    try {
      await setGameIgnored({ data: { draftId, gameId: game.id, ignored } });
      await validateDraft({ data: { draftId } });
      const refreshed = await query.refetch();
      if (ignored) {
        toast.success("Jogo removido desta análise.");
      } else {
        toast.success("Jogo reincluído. A partida voltou para conferência.");
        const refreshedGames = (refreshed.data?.games ?? []) as DraftGame[];
        focusFirstInvalid(refreshedGames);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar este jogo.");
    } finally {
      setTogglingGameId(null);
    }
  }

  async function startAnalysis() {
    setFinalizing(true);
    try {
      const result = await finalizeDraft({ data: { draftId, idempotencyKey: finalizeKey(draftId) } });
      const runId = result.data.runId;
      try {
        await setAnalysisNotificationTarget(runId);
      } catch (error) {
        console.warn("[Web Push] could not persist analysis target", error);
      }
      navigate({ to: "/run/$runId/processamento", params: { runId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ainda existem partidas que precisam ser corrigidas.");
      focusFirstInvalid(invalidGames);
      setFinalizing(false);
    }
  }

  if (!query.isLoading && !query.isError && terminalDraft) {
    return (
      <AppShell stage="upload">
        <div className="mx-auto max-w-3xl">
          <div className="panel mt-5 flex items-start gap-3 p-5" role="status" aria-live="polite">
            <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" aria-hidden />
            <div>
              <p className="font-medium">Esta rodada já foi encerrada</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {finalRunId ? "Abrindo a análise correspondente…" : "Voltando ao início para uma nova análise…"}
              </p>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell stage="upload">
      <div className="mx-auto max-w-4xl">
        <p className="label-eyebrow">Etapa 1 de 4 · enviar e validar</p>
        <h1 className="page-heading mt-2">Conferir as partidas</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Conferimos os times, a competição e o horário. Se houver dúvida, você pode corrigir a partida ou escolher não analisá-la nesta rodada.</p>

        {query.data && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-secondary/25 px-4 py-3 text-xs text-muted-foreground ring-1 ring-border/45">
            <span>Rodada <strong className="font-medium text-foreground">{dateLabel(query.data.draft.target_date)}</strong></span>
            <span>{activeGames.length} para analisar</span>
            <span className="text-success">{validCount} validado(s)</span>
            {invalidGames.length > 0 && <span className="text-warning">{invalidGames.length} precisa(m) de atenção</span>}
            {ignoredCount > 0 && <span>{ignoredCount} ignorado(s)</span>}
          </div>
        )}

        <PushNotificationControl />

        {query.isLoading && (
          <div className="panel mt-5 flex items-center gap-3 p-5 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Conferindo partidas e horários…
          </div>
        )}

        {query.isError && (
          <div className="panel mt-5 border-destructive/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Não foi possível concluir a conferência</p>
                <p className="mt-1 text-sm text-muted-foreground">Tentar novamente não cria outra análise nem duplica o processamento.</p>
                <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
              </div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && ready && (
          <div className="panel mt-5 border-success/25 p-5" role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div><p className="font-medium">Todas as partidas escolhidas foram identificadas</p><p className="mt-1 text-sm text-muted-foreground">Ao continuar, somente os {activeGames.length} jogo(s) mantidos entram na preparação.</p></div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && activeGames.length === 0 && games.length > 0 && (
          <div className="panel mt-5 border-warning/30 p-5" role="alert">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div><p className="font-medium">Nenhum jogo selecionado para análise</p><p className="mt-1 text-sm text-muted-foreground">Reinclua pelo menos um jogo antes de continuar.</p></div>
            </div>
          </div>
        )}

        {!query.isLoading && !query.isError && games.length > 0 && (
          <div className="mt-5 grid gap-3">
            {games.map((game) => {
              const editable = game.editable_fields ?? [];
              const ignored = Boolean(game.ignored);
              const valid = !ignored && game.validation_status === "VALID";
              const resolvedTime = kickoffLabel(game.resolved_kickoff);
              const sourceTime = game.horario?.trim().slice(0, 5) || null;
              const timeDiffers = Boolean(valid && resolvedTime && sourceTime && resolvedTime !== sourceTime);
              const cardTone = ignored ? "border-border/50 opacity-80" : valid ? "border-success/20" : "border-warning/30";
              const badgeTone = ignored ? "bg-secondary text-muted-foreground" : valid ? "bg-success/10 text-success" : "bg-warning/12 text-warning";
              const badgeLabel = ignored ? "Não será analisado" : valid ? "Validado" : "Precisa conferir";
              return (
                <article key={game.id} className={`panel p-4 sm:p-5 ${cardTone}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Jogo {game.ordinal + 1}</p>
                      <h2 className="mt-1 font-semibold">{game.partida}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{game.campeonato} · {dateLabel(game.target_date)} · CSV {game.horario}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${badgeTone}`}>{badgeLabel}</span>
                  </div>

                  {ignored ? (
                    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border/60 bg-secondary/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <CircleOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                        <div><p className="text-sm font-medium">Jogo não será analisado</p><p className="mt-1 text-xs text-muted-foreground">Ele não bloqueará esta rodada e não será enviado ao motor.</p></div>
                      </div>
                      <Button type="button" size="sm" variant="outline" disabled={togglingGameId === game.id} onClick={() => void toggleIgnored(game, false)}>{togglingGameId === game.id ? "Reincluindo…" : "Reincluir jogo"}</Button>
                    </div>
                  ) : valid ? (
                    <div className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
                      <p><span className="font-medium text-foreground">Encontramos:</span> {game.resolved_home_team ?? "—"} x {game.resolved_away_team ?? "—"}</p>
                      <p className="mt-1">{game.resolved_competition ?? game.campeonato}{resolvedTime ? ` · horário confirmado ${resolvedTime}` : ""}</p>
                      {timeDiffers && <p className="mt-1 text-warning">O horário encontrado ({resolvedTime}) difere do CSV ({sourceTime}). Revise antes de continuar se isso não era esperado.</p>}
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 rounded-lg border border-warning/25 bg-warning/8 p-3" role="group" aria-label={`Erros de validação do jogo ${game.ordinal + 1}`}>
                        {(game.validation_errors ?? []).map((item, index) => (
                          <p id={fieldErrorId(game.id, item.field, index)} key={`${item.code}-${index}`} className="text-xs text-warning">{item.message}</p>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {editable.map((field, fieldIndex) => {
                          const key = `${game.id}:${field}`;
                          const isLastField = fieldIndex === editable.length - 1;
                          const matchingErrors = (game.validation_errors ?? [])
                            .map((item, index) => ({ item, index }))
                            .filter(({ item }) => item.field === field);
                          const describedBy = matchingErrors.map(({ item, index }) => fieldErrorId(game.id, item.field, index)).join(" ") || undefined;
                          return (
                            <label key={field} className="text-sm text-muted-foreground" htmlFor={fieldInputId(game.id, field)}>
                              {fieldLabel(field)}
                              <Input
                                id={fieldInputId(game.id, field)}
                                className="mt-1"
                                type={field === "target_date" ? "date" : field === "horario" ? "time" : "text"}
                                inputMode={field === "horario" ? "numeric" : undefined}
                                enterKeyHint={isLastField ? "done" : "next"}
                                autoComplete="off"
                                aria-invalid={matchingErrors.length > 0 || undefined}
                                aria-describedby={describedBy}
                                value={values[key] ?? currentValue(game, field)}
                                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                              />
                            </label>
                          );
                        })}
                      </div>
                      {(game.suggestions ?? []).length > 0 && (
                        <div className="mt-3">
                          <p className="text-sm font-medium">Sugestões encontradas</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(game.suggestions ?? []).slice(0, 5).map((suggestion, index) => (
                              <Button key={index} type="button" size="sm" variant="outline" onClick={() => {
                                const field = editable.includes("target_date") && typeof suggestion["date"] === "string" ? "target_date" : editable.includes("partida") && typeof suggestion["partida"] === "string" ? "partida" : null;
                                if (!field) return;
                                const value = field === "target_date" ? String(suggestion["date"]) : String(suggestion["partida"]);
                                setValues((current) => ({ ...current, [`${game.id}:${field}`]: value }));
                              }}>
                                {String(suggestion["partida"] ?? suggestion["label"] ?? suggestion["date"] ?? `Sugestão ${index + 1}`)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-4 border-t border-border/60 pt-4">
                        <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={togglingGameId === game.id} onClick={() => void toggleIgnored(game, true)}>{togglingGameId === game.id ? "Removendo…" : "Não analisar este jogo"}</Button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {!query.isLoading && !query.isError && invalidGames.length > 0 && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-12" onClick={() => void applyCorrections()} disabled={saving}>{saving ? "Conferindo novamente…" : `Validar ${invalidGames.length} correção${invalidGames.length === 1 ? "" : "ões"}`}</Button>
            <Button variant="outline" className="min-h-12" onClick={() => navigate({ to: "/" })}>Enviar outro CSV</Button>
          </div>
        )}

        {!query.isLoading && !query.isError && ready && (
          <Button className="mt-5 min-h-12 w-full sm:w-auto" onClick={() => void startAnalysis()} disabled={finalizing}>{finalizing ? "Iniciando preparação…" : `Continuar para preparar ${activeGames.length} jogo${activeGames.length === 1 ? "" : "s"}`}</Button>
        )}
      </div>
    </AppShell>
  );
}
