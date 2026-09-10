import { useEffect, useState, type ReactNode } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const ALLOWED_EMAIL = "kauefsantos3@gmail.com";

type AuthState = "loading" | "signed-out" | "authorized" | "denied";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [signingIn, setSigningIn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function applySession(session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) {
      if (!active) return;
      if (!session) {
        setState("signed-out");
        return;
      }

      if (normalizedEmail(session.user.email) !== ALLOWED_EMAIL) {
        setState("denied");
        await supabase.auth.signOut();
        return;
      }

      setState("authorized");
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setMessage("Não foi possível verificar sua sessão. Tente entrar novamente.");
        setState("signed-out");
        return;
      }
      void applySession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    setSigningIn(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setSigningIn(false);
      setMessage(
        error.message.toLowerCase().includes("provider")
          ? "O login Google ainda precisa ser ativado na configuração do Supabase."
          : "Não foi possível abrir o login do Google. Tente novamente.",
      );
    }
  }

  if (state === "authorized") return <>{children}</>;

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Verificando acesso…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.18)_1px,transparent_1px)] bg-[size:55px_55px]" />
      <main className="panel relative z-10 w-full max-w-md p-6 sm:p-8">
        <div className="flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
          <LockKeyhole className="size-5" aria-hidden />
        </div>
        <p className="label-eyebrow mt-6">Acesso privado</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Bet Value Engine
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Este painel é restrito. Entre com a conta Google autorizada para continuar.
        </p>

        {state === "denied" && (
          <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Esta conta Google não tem acesso ao painel.
          </div>
        )}
        {message && (
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {message}
          </div>
        )}

        <Button className="mt-6 min-h-12 w-full" onClick={() => void signIn()} disabled={signingIn}>
          {signingIn ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          Entrar com Google
        </Button>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          A sessão também é validada no servidor antes de qualquer operação com os dados.
        </p>
      </main>
    </div>
  );
}
