import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const vitalSchema = z.object({
  metric: z.enum(["LCP", "CLS", "INP", "TTFB"]),
  value: z.number().finite().min(0).max(1_000_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  route: z.string().trim().min(1).max(160),
});

const UUID_IN_PATH = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function normalizedRoute(route: string) {
  return (route.split("?")[0] || "/").replace(UUID_IN_PATH, ":id").slice(0, 160);
}

export const reportPerformanceVital = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => vitalSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new Error("Usuário não autenticado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("performance_vitals").insert({
      metric: data.metric,
      value: data.value,
      rating: data.rating,
      route: normalizedRoute(data.route),
    });
    if (error) throw new Error(`Falha ao registrar métrica de desempenho: ${error.message}`);
    return { ok: true };
  });
