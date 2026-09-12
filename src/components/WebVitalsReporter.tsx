import { useEffect } from "react";

type VitalMetric = "LCP" | "CLS" | "INP" | "TTFB";
type VitalRating = "good" | "needs-improvement" | "poor";

type ExtendedEntry = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
  duration: number;
};

function rating(metric: VitalMetric, value: number): VitalRating {
  if (metric === "LCP") return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
  if (metric === "CLS") return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
  if (metric === "TTFB") return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
  return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
}

export function WebVitalsReporter() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;

    let cls = 0;
    let lcp = 0;
    let inp = 0;
    let ttfb = 0;
    let sent = false;
    const observers: PerformanceObserver[] = [];

    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation && Number.isFinite(navigation.responseStart) && navigation.responseStart > 0) {
      ttfb = navigation.responseStart;
    }

    const observe = (type: string, handler: (entry: ExtendedEntry) => void) => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) handler(entry as ExtendedEntry);
        });
        observer.observe({ type, buffered: true } as PerformanceObserverInit);
        observers.push(observer);
      } catch {
        // Browser does not expose this performance entry type.
      }
    };

    observe("largest-contentful-paint", (entry) => {
      lcp = Math.max(lcp, entry.startTime);
    });
    observe("layout-shift", (entry) => {
      if (!entry.hadRecentInput) cls += entry.value ?? 0;
    });
    observe("event", (entry) => {
      if ((entry.interactionId ?? 0) > 0) inp = Math.max(inp, entry.duration ?? 0);
    });

    const send = async () => {
      if (sent) return;
      sent = true;
      const metrics: Array<[VitalMetric, number]> = [
        ["LCP", lcp],
        ["CLS", cls],
        ["INP", inp],
        ["TTFB", ttfb],
      ];
      const positiveMetrics = metrics.filter(([, value]) => value > 0);
      if (!positiveMetrics.length) return;
      try {
        const { reportPerformanceVital } = await import("@/lib/performance-vitals.functions");
        await Promise.all(positiveMetrics.map(([metric, value]) => reportPerformanceVital({
          data: { metric, value, rating: rating(metric, value), route: window.location.pathname },
        }).catch(() => undefined)));
      } catch {
        // Telemetry is best-effort and must never affect the product flow.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void send();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      for (const observer of observers) observer.disconnect();
      void send();
    };
  }, []);

  return null;
}
