import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Privacidade · Bet Value Engine" },
      {
        name: "description",
        content: "Como o Bet Value Engine trata dados pessoais, retenção, compartilhamento e exclusão.",
      },
    ],
  }),
  component: PrivacyNotice,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyNotice() {
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-10 sm:px-6">
      <article className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <header>
          <p className="label-eyebrow">Transparência</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Aviso de Privacidade</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Versão de 12/09/2026. Este ambiente é privado e single-user. Enquanto permanecer assim, o próprio mantenedor é o controlador operacional e titular dos dados de conta. Antes de disponibilização a terceiros, este aviso e o canal externo de atendimento devem ser revistos.
          </p>
        </header>

        <Section title="Quais dados são tratados">
          <p><strong className="text-foreground">Conta Google:</strong> UUID, email e identificadores do provedor necessários para login e autorização. Nome, foto e avatar não são necessários e são removidos do metadata persistido pela aplicação.</p>
          <p><strong className="text-foreground">Sessão:</strong> identificador de sessão, IP, user-agent e timestamps para autenticação e segurança.</p>
          <p><strong className="text-foreground">Notificações:</strong> endpoint Web Push, chaves técnicas da assinatura e user-agent apenas quando o usuário ativa os avisos.</p>
          <p><strong className="text-foreground">Uso da aplicação:</strong> histórico de análises, odds informadas, banca, apostas acompanhadas e metadados do CSV processado. O arquivo original não é mantido em Storage pelo fluxo normal.</p>
        </Section>

        <Section title="Para quais finalidades">
          <p>Os dados de identidade e sessão são usados para autenticar a única conta autorizada, aplicar ownership e impedir acesso indevido.</p>
          <p>O histórico esportivo é usado para executar o motor de decisão, acompanhar banca e produzir analytics. As notificações são opcionais e servem apenas para avisar que uma análise terminou.</p>
          <p>Erros podem gerar telemetria técnica sanitizada para diagnóstico. Email, tokens, endpoints Web Push e UUIDs são removidos antes do reporte.</p>
        </Section>

        <Section title="Por quanto tempo ficam armazenados">
          <p><strong className="text-foreground">Sessões:</strong> até 30 dias, com limpeza automática diária.</p>
          <p><strong className="text-foreground">Web Push:</strong> até a desativação, invalidação pelo provedor, exclusão da conta ou 90 dias sem atualização da assinatura.</p>
          <p><strong className="text-foreground">Histórico de análises/apostas:</strong> enquanto a conta estiver ativa, pois compõe o histórico e os indicadores do produto.</p>
          <p><strong className="text-foreground">Trilha de governança:</strong> 365 dias, com expurgo controlado depois do prazo.</p>
        </Section>

        <Section title="Com quem pode haver compartilhamento">
          <p><strong className="text-foreground">Google:</strong> autenticação OAuth.</p>
          <p><strong className="text-foreground">Lovable Cloud / Supabase:</strong> autenticação, banco de dados e execução do backend.</p>
          <p><strong className="text-foreground">Apple Push Service, Google FCM ou Mozilla Push:</strong> somente quando uma assinatura Web Push correspondente estiver ativa. A notificação de conclusão não envia o conteúdo da análise.</p>
          <p>Provedores de dados esportivos recebem requisições sobre partidas e mercados; a aplicação não envia intencionalmente email, UUID de conta ou credenciais de sessão a esses provedores.</p>
        </Section>

        <Section title="Como exercer controle e excluir dados">
          <p>Dentro da área <strong className="text-foreground">Conta e privacidade</strong>, o usuário pode desativar notificações e excluir a própria conta.</p>
          <p>A exclusão remove os dados de aplicação vinculados ao usuário, aproveita os cascades do banco para análises relacionadas, remove a identidade do Auth e encerra as sessões. A trilha de governança pode permanecer pelo prazo definido de 365 dias como evidência de segurança e accountability.</p>
        </Section>

        <Section title="Segurança e minimização">
          <p>O acesso é restrito à conta Google aprovada e os dados operacionais são protegidos por ownership e RLS. O sistema não usa nome ou avatar para autorizar o usuário e não mantém cópia do CSV original no Storage pelo fluxo normal.</p>
        </Section>

        <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Voltar ao Bet Value</a>
          <a href="/conta" className="inline-flex min-h-11 items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-foreground">Conta e privacidade</a>
        </div>
      </article>
    </main>
  );
}
