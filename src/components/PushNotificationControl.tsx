import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPushConfig, savePushSubscription } from "@/lib/push.functions";
import {
  arrayBufferToBase64Url,
  isStandaloneApp,
  registerBetValueServiceWorker,
  supportsWebPush,
  urlBase64ToUint8Array,
} from "@/lib/push.client";

type PushState = "checking" | "available" | "enabled" | "blocked" | "unsupported" | "error";

export function PushNotificationControl() {
  const getConfig = useServerFn(getPushConfig);
  const saveSubscription = useServerFn(savePushSubscription);
  const [state, setState] = useState<PushState>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    let active = true;
    setStandalone(isStandaloneApp());

    if (!supportsWebPush()) {
      setState("unsupported");
      return;
    }

    void (async () => {
      try {
        const [{ publicKey: key }, registration] = await Promise.all([
          getConfig(),
          registerBetValueServiceWorker(),
        ]);
        if (!active) return;
        setPublicKey(key);

        const existing = await registration?.pushManager.getSubscription();
        if (!active) return;
        if (existing && Notification.permission === "granted") {
          setState("enabled");
        } else if (Notification.permission === "denied") {
          setState("blocked");
        } else {
          setState("available");
        }
      } catch {
        if (active) setState("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [getConfig]);

  async function enable() {
    if (!supportsWebPush()) return;
    if (!publicKey) {
      setState("error");
      return;
    }

    setBusy(true);
    try {
      // Permission is requested directly from this tap/click handler, which is
      // required by iOS Home Screen web apps.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "available");
        return;
      }

      const registration = await registerBetValueServiceWorker();
      if (!registration) throw new Error("Service worker indisponível.");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await saveSubscription({
        data: {
          endpoint: subscription.endpoint,
          p256dh: arrayBufferToBase64Url(subscription.getKey("p256dh")),
          auth: arrayBufferToBase64Url(subscription.getKey("auth")),
          userAgent: navigator.userAgent,
        },
      });
      setState("enabled");
    } catch (error) {
      console.error("[Web Push] subscription failed", error);
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <div className="panel mt-4 flex items-center gap-3 p-4 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Verificando notificações…
      </div>
    );
  }

  if (state === "enabled") {
    return (
      <div className="panel mt-4 flex items-start gap-3 border-success/25 p-4">
        <Bell className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-medium">Notificações ativadas</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Você pode sair do Bet Value ou bloquear o iPhone. Avisaremos quando a análise estiver pronta.
          </p>
        </div>
      </div>
    );
  }

  if (state === "blocked") {
    return (
      <div className="panel mt-4 flex items-start gap-3 p-4">
        <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">Notificações bloqueadas</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A análise continua em segundo plano. Para receber avisos, libere o Bet Value em Ajustes → Notificações no iPhone.
          </p>
        </div>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className="panel mt-4 flex items-start gap-3 p-4">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">Avisos não disponíveis neste modo</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            No iPhone, abra o Bet Value pelo ícone adicionado à Tela de Início para usar notificações.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Bell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">Receber aviso quando terminar</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {standalone
              ? "Ative uma vez e pode sair do app enquanto a análise continua no servidor."
              : "No iPhone, funciona melhor pelo Bet Value instalado na Tela de Início."}
          </p>
          {state === "error" && (
            <p className="mt-1 text-xs text-warning">Não foi possível preparar os avisos agora. Tente novamente.</p>
          )}
        </div>
      </div>
      <Button className="min-h-11 shrink-0" onClick={() => void enable()} disabled={busy || !publicKey}>
        {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <Bell className="mr-2 size-4" aria-hidden />}
        Ativar notificações
      </Button>
    </div>
  );
}
