import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getPersistedExperimentalResult } from "@/lib/experimental-result-ledger.functions";

function experimentalRunIdFromLocation() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/run\/([^/]+)\/resultado$/);
  if (!match || new URLSearchParams(window.location.search).get("mode") !== "experimental") return null;
  return match[1] ?? null;
}

export function ExperimentalResultHydrator({ children }: { children: ReactNode }) {
  const runId = useMemo(() => experimentalRunIdFromLocation(), []);
  const loadPersisted = useServerFn(getPersistedExperimentalResult);
  const [ready, setReady] = useState(runId === null);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    const cacheKey = `experimental-result:${runId}`;

    try {
      if (window.localStorage.getItem(cacheKey)) {
        setReady(true);
        return;
      }
    } catch {
      // Server recovery below is authoritative; localStorage is optional cache.
    }

    void loadPersisted({ data: { runId } })
      .then(({ result }) => {
        if (!active) return;
        if (result) {
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(result));
          } catch {
            // A hardened/private browser may reject localStorage. In that case
            // the route still has a server-side snapshot available on refresh.
          }
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [loadPersisted, runId]);

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Recuperando resultado da análise…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
