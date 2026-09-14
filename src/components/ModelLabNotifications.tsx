import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCircle2, FlaskConical, Info, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getModelLabNotifications,
  markModelLabNotificationsRead,
  type ModelLabEvent,
} from "@/lib/model-lab.functions";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function EventIcon({ severity }: { severity: ModelLabEvent["severity"] }) {
  if (severity === "SUCCESS") return <CheckCircle2 className="size-4" aria-hidden />;
  if (severity === "WARNING" || severity === "ERROR") return <TriangleAlert className="size-4" aria-hidden />;
  return <Info className="size-4" aria-hidden />;
}

export function ModelLabNotifications() {
  const load = useServerFn(getModelLabNotifications);
  const markRead = useServerFn(markModelLabNotificationsRead);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["model-lab-notifications"],
    queryFn: () => load(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const markMutation = useMutation({
    mutationFn: () => markRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["model-lab-notifications"] }),
  });

  const events = query.data?.events ?? [];
  const unread = query.data?.unreadCount ?? 0;
  const latest = events[0] ?? null;

  return (
    <section className="mx-auto mb-5 max-w-4xl overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.035]" aria-label="Laboratório Stage 9" data-testid="model-lab-notifications">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <FlaskConical className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Laboratório Stage 9</p>
              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">em paralelo</span>
              {unread > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Bell className="size-3" aria-hidden /> {unread} nova{unread === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              O modo diversão continua ativo com o uncertainty-linear 40%. A Stage 9 testa e acompanha melhorias sem bloquear suas análises.
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-xl border border-border/70 bg-background/75 px-3 py-2 text-xs">
          <span className="block text-muted-foreground">Modo diversão</span>
          <strong className="mt-0.5 block font-medium text-foreground">Ativo · experimental</strong>
        </div>
      </div>

      <div className="border-t border-border/60 bg-background/35 px-4 py-3 sm:px-5">
        {query.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando novidades do laboratório…</p>
        ) : query.isError ? (
          <p className="text-xs text-muted-foreground">O laboratório continua independente, mas as notificações não puderam ser atualizadas agora.</p>
        ) : latest ? (
          <div className="flex gap-2.5">
            <span className="mt-0.5 text-primary"><EventIcon severity={latest.severity} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium">{latest.title}</p>
                <time className="text-[11px] text-muted-foreground" dateTime={latest.created_at}>{timeLabel(latest.created_at)}</time>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{latest.message}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A Stage 9 está configurada para trabalhar em segundo plano. As próximas mudanças relevantes aparecerão aqui.</p>
        )}

        {events.length > 1 && (
          <details className="mt-3 border-t border-border/50 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-foreground">Ver histórico recente ({events.length})</summary>
            <ol className="mt-3 space-y-3">
              {events.slice(1).map((event) => (
                <li key={event.id} className="flex gap-2.5 text-xs">
                  <span className="mt-0.5 text-muted-foreground"><EventIcon severity={event.severity} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-foreground">{event.title}</span>
                      <time className="text-[10px] text-muted-foreground" dateTime={event.created_at}>{timeLabel(event.created_at)}</time>
                    </div>
                    <p className="mt-0.5 leading-relaxed text-muted-foreground">{event.message}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}

        {unread > 0 && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" disabled={markMutation.isPending} onClick={() => markMutation.mutate()}>
              Marcar como lidas
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
