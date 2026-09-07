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

const SUPPORTED_SOURCES = new Set(["five_dollar_football", "api_football"]);

export function SourceAudit({ runId, refreshKey }: { runId: string; refreshKey: number }) {
  const load = useServerFn(getAudit);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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

  const providerLabel = sources.map((source) => source.source).join(" + ");

  return (
    <section className="panel mt-8 p-6">
      <p className="label-eyebrow">Auditoria da ingestão</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Provedor desta rodada: <span className="font-medium text-foreground">{providerLabel}</span>
      </p>

      <ul className="mt-4 space-y-2">
        {sources.map((source) => (
          <li key={source.source} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="num font-medium uppercase">{source.source}</span>
            <span className={`num font-medium ${STATUS_CLASS[source.status] ?? "text-muted-foreground"}`}>
              {source.status}
            </span>
            <span className="num text-xs text-muted-foreground">
              {source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleTimeString("pt-BR") : "—"}
            </span>
            {source.lastError && <span className="text-xs text-muted-foreground">{source.lastError}</span>}
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="label-eyebrow">Eventos resolvidos</dt>
          <dd className="num mt-1 text-2xl">{resolvedEvents}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Observações brutas</dt>
          <dd className="num mt-1 text-2xl">{audit.rawObservations}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Normalizadas</dt>
          <dd className="num mt-1 text-2xl">{audit.normalizedObservations}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Partidas</dt>
          <dd className="num mt-1 text-2xl">{audit.matches.length}</dd>
        </div>
      </dl>

      <ul className="mt-5 divide-y divide-border border-t border-border">
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
                <span className="num text-xs text-muted-foreground">{match.resolution_status}</span>
                <ChevronDown
                  className={`size-4 transition-transform ${open === match.id ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </span>
            </button>

            {open === match.id && (
              <div className="pb-4 text-xs text-muted-foreground">
                <p>{match.resolution_reason}</p>
                <p className="num mt-1">
                  confiança {match.resolver_confidence === null ? "—" : Number(match.resolver_confidence).toFixed(2)}
                  {match.externalIds.length > 0 &&
                    ` · ${match.externalIds.map((id) => `${id.source}=${id.external_id}`).join(" · ")}`}
                </p>

                {match.normalized.length > 0 ? (
                  <ul className="num mt-2 space-y-1">
                    {match.normalized.map((row, index) => (
                      <li key={index}>
                        {row.scope} {row.metric}: {Number(row.normalized_value).toFixed(2)} (n={row.sample_size},{" "}
                        {row.source}/{row.definition_version})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2">Nenhum dado normalizado passou nos gates de definição.</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
