# Fechamento da auditoria de Segurança da Informação — 12/09/2026

Este documento supersede os riscos residuais descritos em `SECURITY_HARDENING_2026-09-11.md` para o estado atual da aplicação.

## Escopo fechado

A auditoria foi conduzida com referência ao OWASP ASVS 5.0.0 e cobriu autenticação, sessão, recuperação de conta, exposição de chaves, upload/ingestão de CSV, SSRF e superfícies de ataque, dependências, autorização/RLS, worker em segundo plano e headers/CSP.

## Correções finais

### CSP sem `unsafe-inline`

- cada resposta HTML recebe um nonce criptográfico novo;
- o mesmo nonce é inserido nos elementos `script` e `style` gerados pelo runtime;
- `script-src` e `style-src` aceitam apenas `self` e o nonce da resposta;
- atributos de script e estilo inline são bloqueados;
- `unsafe-inline` e `unsafe-eval` não fazem parte da política.

### OAuth sem broker legado

- `@lovable.dev/cloud-auth-js` foi removido de `package.json` e `bun.lock`;
- o login Google usa diretamente `supabase.auth.signInWithOAuth`;
- a sessão continua sendo a sessão Supabase usada pelo restante da aplicação;
- a origem do broker OAuth legado também foi removida da CSP.

### Identidade aprovada sem literal privilegiado

- nenhum e-mail ou UUID de conta aprovada é necessário no código de autenticação atual;
- a identidade canônica é vinculada uma única vez e armazenada somente em `private.app_security_config`;
- em produção, a migração preserva a conta Google já estabelecida; em ambiente novo, a primeira conta Google válida sela atomicamente a identidade;
- excluir a conta não transfere automaticamente a autorização para uma conta posterior;
- a autorização do JWT é consultada por um RPC booleano `is_approved_app_user()`;
- o middleware falha fechado se a consulta não puder ser validada;
- as migrations atuais não incorporam e-mail privilegiado.

## Regressões automatizadas

O repositório contém testes que impedem o retorno de `unsafe-inline`, do pacote OAuth legado e de um e-mail privilegiado nas superfícies atuais de autenticação/migrations. A suíte de segurança do banco valida privilégios do RPC e o smoke publicado verifica nonce/CSP, login privado, headers de segurança, robots e o endpoint protegido.

## Interpretação de “100% fechado”

Significa que 100% dos achados identificados nesta auditoria foram corrigidos ou eliminados no estado atual, com regressões automatizadas. Não significa garantia matemática de ausência de vulnerabilidades futuras; novas dependências, funcionalidades, configurações ou mudanças de infraestrutura devem continuar passando pelos gates de segurança existentes.

Observação histórica: versões antigas de um repositório público podem permanecer replicadas em caches, clones ou forks externos. A aplicação atual não depende desses identificadores históricos para autenticação ou autorização.
