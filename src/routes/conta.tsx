import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BellOff, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { deleteMyAccount, disableMyPushNotifications } from "@/lib/privacy.functions";

export const Route = createFileRoute("/conta")({
  head: () => ({
    meta: [
      { title: "Conta e privacidade · Bet Value Engine" },
      { name: "description", content: "Controles de privacidade, notificações e exclusão da conta." },
    ],
  }),
  component: AccountPrivacyPage,
});

function AccountPrivacyPage() {
  const disablePush = useServerFn(disableMyPushNotifications);
  const removeAccount = useServerFn(deleteMyAccount);
  const [confirmation, setConfirmation] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function disableNotifications() {
    setPushBusy(true);
    setMessage(null);
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      await disablePush();
      setMessage("Notificações desativadas e assinatura removida do servidor.");
    } catch {
      setMessage("Não foi possível desativar as notificações agora.");
    } finally {
      setPushBusy(false);
    }
  }

  async function deleteAccount() {
    if (confirmation !== "EXCLUIR MINHA CONTA") return;
    setDeleteBusy(true);
    setMessage(null);
    try {
      await removeAccount({ data: { confirmation: "EXCLUIR MINHA CONTA" } });
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The server has already deleted the Auth user; local cleanup is best effort.
      }
      window.location.assign("/");
    } catch {
      setMessage("A exclusão não foi concluída. Nenhuma confirmação de sucesso foi emitida; tente novamente.");
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell stage="account">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <p className="label-eyebrow">Privacidade</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Conta e privacidade</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Consulte como os dados são tratados, desative notificações ou exclua integralmente a conta e os dados vinculados.
              </p>
              <a href="/privacidade" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                Ler o Aviso de Privacidade
              </a>
            </div>
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <BellOff className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Notificações</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Desativar remove a assinatura Web Push deste navegador e todas as assinaturas vinculadas à sua conta no servidor.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => void disableNotifications()} disabled={pushBusy}>
                {pushBusy ? "Desativando…" : "Desativar notificações"}
              </Button>
            </div>
          </div>
        </section>

        <section className="panel border-destructive/35 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-5 text-destructive" aria-hidden />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-destructive">Excluir conta e dados</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Esta ação remove análises, jobs, histórico de apostas vinculado, configuração pessoal de banca, assinaturas push e a identidade de autenticação. A trilha de governança segue a retenção limitada descrita no Aviso de Privacidade.
              </p>
              <label className="mt-4 block text-sm font-medium" htmlFor="delete-confirmation">
                Digite <span className="font-mono">EXCLUIR MINHA CONTA</span> para confirmar
              </label>
              <input
                id="delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                variant="destructive"
                className="mt-4"
                onClick={() => void deleteAccount()}
                disabled={deleteBusy || confirmation !== "EXCLUIR MINHA CONTA"}
              >
                {deleteBusy ? "Excluindo…" : "Excluir definitivamente"}
              </Button>
            </div>
          </div>
        </section>

        {message && <div className="panel p-4 text-sm text-muted-foreground" role="status">{message}</div>}
      </div>
    </AppShell>
  );
}
