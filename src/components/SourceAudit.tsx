import { useEffect, useState } from "react";
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

  if (!audit || audit.sources.length === 0) return null;

  return (
    <section className="panel mt-8 p-6">
      <p className="label-eyebrow">Auditoria da ingestão</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Modo de coleta: <span className="font-medium text-foreground">{audit.mode}</span>
      </p>

      <ul className="mt-4 space-y-2">
        {audit.sources.map((s) => (
          <li key={s.source} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="num font-medium uppercase">{s.source}</span>
            <span className={`num font-medium ${STATUS_CLASS[s.status] ?? "text-muted-foreground"}`}>
              {s.status}
            </span>
            <span className="num text-xs text-muted-foreground">
              {s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleTimeString("pt-BR") : "—"}
            </span>
            {s.lastError && (
              <span className="text-xs text-muted-foreground">{s.lastError}</span>
            )}
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="label-eyebrow">Eventos resolvidos</dt>
          <dd className="num mt-1 text-2xl">{audit.resolvedEvents + audit.researchResolved}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Observações brutas</dt>
          <dd className="num mt-1 text-2xl">{audit.rawObservations}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Observações normalizadas</dt>
          <dd className="num mt-1 text-2xl">{audit.normalizedObservations}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Confirmadas entre fontes</dt>
          <dd className="num mt-1 text-2xl">{audit.crossChecked}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Conflitos entre fontes</dt>
          <dd className="num mt-1 text-2xl">{audit.sourceConflicts}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Partidas</dt>
          <dd className="num mt-1 text-2xl">{audit.matches.length}</dd>
        </div>
      </dl>


      <ul className="mt-5 divide-y divide-border border-t border-border">
        {audit.matches.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setOpen(open === m.id ? null : m.id)}
              className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm"
            >
              <span className="min-w-0 truncate">
                {m.home_team && m.away_team ? `${m.home_team} x ${m.away_team}` : m.raw_partida}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="num text-xs text-muted-foreground">{m.resolution_status}</span>
                <ChevronDown
                  className={`size-4 transition-transform ${open === m.id ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </span>
            </button>
            {open === m.id && (
              <div className="pb-4 text-xs text-muted-foreground">
                <p>{m.resolution_reason}</p>
                <p className="num mt-1">
                  confiança {m.resolver_confidence === null ? "—" : Number(m.resolver_confidence).toFixed(2)}
                  {m.externalIds.length > 0 &&
                    ` · ${m.externalIds.map((e) => `${e.source}=${e.external_id}`).join(" · ")}`}
                </p>
                {m.normalized.length > 0 ? (
                  <ul className="num mt-2 space-y-1">
                    {m.normalized.map((n, i) => (
                      <li key={i}>
                        {n.scope} {n.metric}: {Number(n.normalized_value).toFixed(2)} (n={n.sample_size},{" "}
                        {n.source}/{n.definition_version})
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
