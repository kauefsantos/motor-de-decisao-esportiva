import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";

import { getAudit } from "@/lib/analysis.functions";

type Audit = Awaited<ReturnType<typeof getAudit>>;

const STATUS_CLASS: Record<string, string> = {
  OK: "text-success",
  PARTIAL: "text-warning",
  UNAVAILABLE: "text-destructive",
  NOT_CONFIGURED: "text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  OK: "Funcionando normalmente",
  PARTIAL: "Funcionando parcialmente",
  UNAVAILABLE: "Indisponível agora",
  NOT_CONFIGURED: "Ainda não configurada",
};

const SOURCE_LABEL: Record<string, string> = {
  five_dollar_football: "5DollarFootball",
  api_football: "API-Football",
};

const RESOLUTION_LABEL: Record<string, string> = {
  RESOLVED: "Jogo encontrado",
  PARTIAL: "Jogo encontrado parcialmente",
  UNRESOLVED: "Jogo não encontrado",
  FAILED: "Não foi possível encontrar o jogo",
};

const SUPPORTED_SOURCES = new Set(["five_dollar_football", "api_football"]);

export function SourceAudit({ runId, refreshKey }: { runId: string; refreshKey: number }) {
  const load = useServerFn(getAudit);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let active = true;
    void load({ data: { runId } })
      .then((res) => {
        if (active) setAudit(res);
      })
      .catch(() => {
        if (active) setAudit(null);
      });
    return () => {
      active = false;
    };
  }, [load, runId, refreshKey]);

  const sources = useMemo(
    () => (audit?.sources ?? []).filter((source) => SUPPORTED_SOURCES.has(source.source)),
    [audit],
  );

  const resolvedEvents = useMemo(
    () =>
      (audit?.matches ?? []).filter((match) =>
        match.externalIds.some(
          (id) => id.source === "five_dollar_fixture" || id.source === "api_football_fixture",
        ),
      ).length,
    [audit],
  );

  if (!audit || sources.length === 0) return null;

  return (
    <section className="panel mt-8 p-6">
      <button
        type="button"
        onClick={() => setShowMore((value) => !value)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <p className="label-eyebrow">Conferência das informações</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Veja quantos jogos foram encontrados e se as fontes de dados responderam normalmente.
          </p>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${showMore ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Jogos encontrados</p>
          <p className="num mt-1 text-2xl">{resolvedEvents}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Jogos enviados</p>
          <p className="num mt-1 text-2xl">{audit.matches.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Informações recebidas</p>
          <p className="num mt-1 text-2xl">{audit.rawObservations}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Informações aproveitadas</p>
          <p className="num mt-1 text-2xl">{audit.normalizedObservations}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-2">
        {sources.map((source) => (
          <li key={source.source} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{SOURCE_LABEL[source.source] ?? source.source}</span>
            <span className={`font-medium ${STATUS_CLASS[source.status] ?? "text-muted-foreground"}`}>
              {STATUS_LABEL[source.status] ?? "Situação desconhecida"}
            </span>
            {source.lastFetchedAt && (
              <span className="text-xs text-muted-foreground">
                consultada às {new Date(source.lastFetchedAt).toLocaleTimeString("pt-BR")}
              </span>
            )}
          </li>
        ))}
      </ul>

      {showMore && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Use esta parte somente se quiser conferir por que algum jogo não apareceu como esperado.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {audit.matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === match.id ? null : match.id)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm"
                >
                  <span className="min-w-0 truncate">
                    {match.home_team && match.away_team
                      ? `${match.home_team} x ${match.away_team}`
                      : match.raw_partida}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {RESOLUTION_LABEL[match.resolution_status] ?? "Em conferência"}
                    </span>
                    <ChevronDown
                      className={`size-4 transition-transform ${open === match.id ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>

                {open === match.id && (
                  <div className="pb-4 text-xs text-muted-foreground">
                    <p>{match.resolution_reason}</p>
                    <p className="mt-1">
                      Grau de certeza na identificação: {match.resolver_confidence === null ? "—" : `${(Number(match.resolver_confidence) * 100).toFixed(0)}%`}
                    </p>
                    <p className="mt-1">
                      Informações aproveitadas para este jogo: {match.normalized.length}
                    </p>
                    {match.normalized.length === 0 && (
                      <p className="mt-2">Nenhuma informação aproveitável ficou disponível para este jogo.</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}