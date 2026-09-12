import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const deleteAccountSchema = z.object({
  confirmation: z.literal("EXCLUIR MINHA CONTA"),
});

type PrivacyRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

type PrivacyRpc = (
  fn: "erase_user_application_data",
  args: { p_user_id: string },
) => PromiseLike<PrivacyRpcResult>;

export const disableMyPushNotifications = createServerFn({ method: "POST" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new Error("Usuário não autenticado.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
});

export const deleteMyAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => deleteAccountSchema.parse(input))
  .handler(async ({ data: _data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Usuário não autenticado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const privacyRpc = supabaseAdmin.rpc as unknown as PrivacyRpc;

    const { error: cleanupError } = await privacyRpc("erase_user_application_data", {
      p_user_id: userId,
    });
    if (cleanupError) {
      throw new Error(`Falha ao eliminar os dados da aplicação: ${cleanupError.message}`);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(`Falha ao eliminar a conta de autenticação: ${deleteError.message}`);
    }

    return { ok: true };
  });
