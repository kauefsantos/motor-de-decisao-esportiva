import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
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
  PARTIAL: "Encontrado parcialmente",
  UNRESOLVED: "Não encontrado",
  FAILED: "Falha na identificação",
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

  return (
    <CollapsiblePanel
      className="mt-4"
      title="Conferência das informações"
      description="Fontes, identificação dos jogos e dados aproveitados"
      meta={`${resolvedEvents}/${audit.matches.length} jogos`}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Jogos encontrados</p><p className="num mt-1 text-lg">{resolvedEvents}</p></div>
        <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Jogos enviados</p><p className="num mt-1 text-lg">{audit.matches.length}</p></div>
        <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Dados recebidos</p><p className="num mt-1 text-lg">{audit.rawObservations}</p></div>
        <div className="metric-tile p-3"><p className="text-[11px] text-muted-foreground">Dados aproveitados</p><p className="num mt-1 text-lg">{audit.normalizedObservations}</p></div>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <li key={source.source} className="metric-tile flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="font-medium">{SOURCE_LABEL[source.source] ?? source.source}</span>
            <span className={`text-xs font-medium ${STATUS_CLASS[source.status] ?? "text-muted-foreground"}`}>
              {STATUS_LABEL[source.status] ?? "Situação desconhecida"}
            </span>
            {source.lastFetchedAt && (
              <span className="w-full text-[11px] text-muted-foreground">consultada às {new Date(source.lastFetchedAt).toLocaleTimeString("pt-BR")}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Abra um jogo apenas se quiser entender como ele foi identificado.</p>
        <ul className="mt-2 divide-y divide-border">
          {audit.matches.map((match) => {
            const isOpen = open === match.id;
            const buttonId = `source-audit-button-${match.id}`;
            const detailsId = `source-audit-details-${match.id}`;
            const resolutionLabel = match.resolution_status
              ? (RESOLUTION_LABEL[match.resolution_status] ?? "Em conferência")
              : "Em conferência";
            return (
              <li key={match.id}>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={detailsId}
                  onClick={() => setOpen(isOpen ? null : match.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm"
                >
                  <span className="min-w-0 truncate">
                    {match.home_team && match.away_team ? `${match.home_team} x ${match.away_team}` : match.raw_partida}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{resolutionLabel}</span>
                    <ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                  </span>
                </button>
                {isOpen && (
                  <div id={detailsId} role="region" aria-labelledby={buttonId} className="pb-3 text-xs leading-relaxed text-muted-foreground">
                    <p>{match.externalIds.length > 0 ? "Jogo relacionado às informações encontradas nas fontes disponíveis." : "Não foi possível relacionar este jogo a uma partida das fontes disponíveis."}</p>
                    <p className="mt-1">Certeza na identificação: {match.resolver_confidence === null ? "—" : `${(Number(match.resolver_confidence) * 100).toFixed(0)}%`} · Informações aproveitadas: {match.normalized.length}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <Link
          to="/diagnostico"
          className="flex min-h-11 items-center justify-center rounded-xl bg-secondary/35 px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Ver funil de decisão
        </Link>
      </div>
    </CollapsiblePanel>
  );
}
