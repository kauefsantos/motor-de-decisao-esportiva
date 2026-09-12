import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { isTrustedPushEndpoint } from "./push-endpoint";

const trustedPushEndpointSchema = z
  .string()
  .url()
  .max(4096)
  .refine(isTrustedPushEndpoint, "Endpoint Web Push não autorizado.");

const subscriptionSchema = z.object({
  endpoint: trustedPushEndpointSchema,
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  userAgent: z.string().max(1024).optional(),
});

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const getPushConfig = createServerFn({ method: "POST" }).handler(async () => {
  const { getVapidPublicKey } = await import("./push.server");
  return { publicKey: getVapidPublicKey() };
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => subscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");

    const supabase = await db();
    const { data: existing, error: lookupError } = await supabase
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", data.endpoint)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.user_id !== userId) {
      const error = new Error("Este endpoint de notificação pertence a outra conta.") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ endpoint: z.string().url().max(4096) }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");
    const supabase = await db();
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint);
    if (error) throw error;
    return { ok: true };
  });
