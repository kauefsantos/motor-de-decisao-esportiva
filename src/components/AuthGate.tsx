import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type AuthState = "loading" | "signed-out" | "authorized";

const MOBILE_AUTH_KEY = "bet-value-mobile-auth-at";
const MOBILE_AUTH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function currentReturnUrl() {
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return new URL(destination || "/", window.location.origin).toString();
}

function isMobileExperience() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.matchMedia?.("(max-width: 767px) and (pointer: coarse)")?.matches === true
  );
}

function readMobileAuthAt() {
  try {
    const raw = window.localStorage.getItem(MOBILE_AUTH_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeMobileAuthAt() {
  try {
    window.localStorage.setItem(MOBILE_AUTH_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in hardened/private browser modes. The
    // Supabase session remains the security boundary even without this UX timer.
  }
}

function clearMobileAuthAt() {
  try {
    window.localStorage.removeItem(MOBILE_AUTH_KEY);
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
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
        if (isMobileExperience()) clearMobileAuthAt();
        setState("signed-out");
        return;
      }

      // The browser gate is UX only. The actual allowlist is enforced twice on
      // trusted boundaries: auth.users in the database and requireSupabaseAuth
      // before every serverFn. Do not expose the private allowlisted email here.
      const provider = String(session.user.app_metadata?.provider ?? "");
      if (provider !== "google") {
        setMessage("Esta sessão não tem acesso ao painel.");
        await supabase.auth.signOut();
        if (active) setState("signed-out");
        return;
      }

      if (isMobileExperience()) {
        const authenticatedAt = readMobileAuthAt();
        if (authenticatedAt !== null && Date.now() - authenticatedAt >= MOBILE_AUTH_MAX_AGE_MS) {
          clearMobileAuthAt();
          await supabase.auth.signOut();
          if (active) {
            setMessage("Seu acesso mobile de 30 dias terminou. Entre novamente para continuar.");
            setState("signed-out");
          }
          return;
        }
        if (authenticatedAt === null) writeMobileAuthAt();
      }

      setMessage(null);
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

    try {
      // Lovable managed OAuth is browser-only. Import it lazily so SSR never
      // evaluates createLovableAuth() while rendering the login screen.
      const { lovable } = await import("@/integrations/lovable");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: currentReturnUrl(),
        extraParams: { prompt: "select_account" },
      });

      if (result.error) {
        setSigningIn(false);
        setMessage("Não foi possível abrir o login do Google. Tente novamente.");
      }
    } catch {
      setSigningIn(false);
      setMessage("Não foi possível abrir o login do Google. Tente novamente.");
    }
  }

  if (state === "authorized") return <>{children}</>;

  if (state === "loading") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Verificando acesso…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.18)_1px,transparent_1px)] bg-[size:55px_55px]" />
      <main className="panel relative z-10 w-full max-w-md p-6 sm:p-8">
        <img
          src="/icons/icon-192.png"
          alt=""
          className="size-14 rounded-2xl border border-primary/20 shadow-lg shadow-primary/10"
          aria-hidden
        />
        <p className="label-eyebrow mt-6">Acesso privado</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Bet Value Engine
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Entre com a conta Google autorizada. No mobile, o acesso fica ativo por até 30 dias antes de pedir uma nova autenticação.
        </p>

        {message && (
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="alert">
            {message}
          </div>
        )}

        <Button className="mt-6 min-h-12 w-full" onClick={() => void signIn()} disabled={signingIn}>
          {signingIn ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          Entrar com Google
        </Button>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          A sessão continua sendo validada no servidor antes de qualquer operação com os dados.
        </p>
      </main>
    </div>
  );
}
