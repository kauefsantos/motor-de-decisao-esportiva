# Registro de operações de tratamento de dados pessoais

Última revisão: 12/09/2026.

A fonte executável correspondente é `public.privacy_processing_activities` no Lovable Cloud.

| Atividade | Dados | Finalidade | Justificativa operacional | Compartilhamento | Retenção | Exclusão |
|---|---|---|---|---|---|---|
| Google identity | UUID, email, provider IDs | autenticação e autorização | funcionalidade solicitada + segurança | Google; Lovable/Supabase | vida da conta | exclusão do usuário Auth |
| Auth session | session id, IP, user-agent, timestamps | validar requisições e impedir acesso indevido | segurança/prevenção a fraude | Lovable/Supabase | 30 dias | cleanup diário / exclusão da conta |
| Ownership | UUID em tabelas operacionais | associar dados ao titular correto | execução do serviço | Lovable/Supabase | vida da conta | account erasure |
| Web Push | endpoint, p256dh, auth, user-agent | avisar conclusão de análise | recurso opcional solicitado | Apple/FCM/Mozilla | até desativação/invalidação ou 90 dias inativo | self-service + cleanup |
| Upload metadata | filename, headers | descrever CSV processado | execução do serviço | Lovable/Supabase | vida da análise/conta | cascade do run/conta |
| Sports history | ownership, odds, banca, apostas | motor, histórico e analytics | execução do serviço | Lovable/Supabase | vida da conta | account erasure |
| Error telemetry | rota/erro/stack sanitizados | diagnóstico | segurança e confiabilidade | runtime Lovable quando disponível | sem identificadores pessoais crus intencionais | redaction antes do envio |
| Governance audit | actor UUID, before/after, timestamp | accountability e investigação | segurança/auditoria | Lovable/Supabase | 365 dias | cleanup controlado |

## Regras de minimização

- nome, full_name, avatar_url e picture não são necessários para autorização e são removidos do metadata persistido;
- o OAuth solicita somente `openid email`;
- o CSV original não é armazenado em `storage.objects` pelo fluxo normal;
- telemetria nunca deve receber Authorization, cookie, JWT, email, endpoint Web Push ou UUID cru.

## Mudanças futuras

Qualquer nova coluna ou integração que possa conter dado pessoal deve atualizar este registro e `docs/PRIVACY.md` no mesmo PR. O CI considera arquivos de autenticação, privacidade, telemetria e migrations como mudanças governadas.
