import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const vitalSchema = z.object({
  metric: z.enum(["LCP", "CLS", "INP", "TTFB"]),
  value: z.number().finite().min(0).max(1_000_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  route: z.string().trim().min(1).max(160),
});

export const reportPerformanceVital = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => vitalSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new Error("Usuário não autenticado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("performance_vitals").insert({
      metric: data.metric,
      value: data.value,
      rating: data.rating,
      route: data.route.split("?")[0]?.slice(0, 160) || "/",
    });
    if (error) throw new Error(`Falha ao registrar métrica de desempenho: ${error.message}`);
    return { ok: true };
  });
