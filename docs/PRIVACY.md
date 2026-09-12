# Privacidade e tratamento de dados pessoais

Versão operacional: 12/09/2026.

Este documento é a fonte técnica canônica do Aviso de Privacidade exibido em `/privacidade`. O projeto continua sendo um ambiente privado, single-user e single-maintainer. Antes de disponibilização a terceiros, a identidade formal do controlador, canal externo para titulares, contratos/DPA e transferências internacionais devem ser revistos.

## Princípios aplicados

- finalidade e necessidade: coletar apenas o necessário para autenticação, segurança e funcionamento do motor;
- transparência: aviso público disponível antes do login;
- minimização: OAuth solicita `openid email`; nome/avatar/picture são removidos do metadata persistido;
- segurança: ownership, RLS, sessão absoluta de 30 dias e telemetria sanitizada;
- retenção limitada: sessões 30 dias, push inativo 90 dias, governança 365 dias;
- exclusão: fluxo self-service em `/conta`, além de cleanup defensivo quando `auth.users` é removido administrativamente.

## Compartilhamento

- Google: autenticação OAuth;
- Lovable Cloud / Supabase: autenticação, banco e backend;
- Apple Push Service, Google FCM ou Mozilla Push: somente se Web Push estiver ativo no respectivo dispositivo;
- provedores esportivos: recebem dados de partidas/mercados, não identificadores pessoais da conta por desenho da aplicação.

## Retenção

| Categoria | Retenção operacional |
|---|---|
| Sessões Auth | 30 dias |
| Web Push inativo | 90 dias sem atualização |
| Histórico de análises/apostas | enquanto a conta estiver ativa |
| Governance change log | 365 dias |
| Identity/Auth | enquanto a conta estiver ativa |

`public.run_privacy_retention_cleanup()` executa diariamente via `pg_cron`. A exclusão de conta remove imediatamente os dados de aplicação vinculados; o histórico de governança segue a retenção limitada de 365 dias como evidência de segurança/accountability.

## Direitos e controles

A área `/conta` permite:

1. abrir o Aviso de Privacidade;
2. desativar notificações e apagar as assinaturas Web Push do servidor;
3. excluir definitivamente conta e dados, mediante confirmação textual explícita.

A exclusão chama primeiro `erase_user_application_data(user_id)` e em seguida remove o usuário do Supabase Auth. Um trigger `cleanup_deleted_app_user` repete a limpeza de forma idempotente quando um usuário é apagado diretamente no Auth.

## Telemetria

Antes de qualquer envio aos hooks de runtime, `lovable-error-reporting.ts` remove email, tokens Bearer/JWT, endpoints Web Push, UUIDs e campos cujo nome indica segredo, autenticação ou identificador sensível. O banco da aplicação não mantém uma cópia própria dessa telemetria.

Na revisão de Arquitetura e Qualidade do Código de 12/09/2026, a suíte `lovable-error-reporting.test.ts` foi ajustada apenas para acesso indexado às propriedades do objeto sanitizado, preservando integralmente os mesmos casos de teste e as mesmas expectativas de redação (`authorization`, `route` e `nested`). Não houve mudança na política, no conjunto de dados redigidos nem no comportamento de telemetria; o registro desta alteração existe para manter a documentação canônica sincronizada com o gate de privacidade do CI.

## Pontos externos que continuam sujeitos a evidência do fornecedor

- localização física/região final de processamento do Lovable/Supabase;
- termos/DPA e mecanismos de transferência internacional;
- retenção interna de infraestrutura dos provedores além dos registros controlados pela aplicação.

Esses itens não devem ser presumidos como conformes em uma futura oferta a terceiros; exigem revisão contratual antes de comercialização.
