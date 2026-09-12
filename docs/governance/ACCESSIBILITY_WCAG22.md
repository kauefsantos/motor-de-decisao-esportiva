# Acessibilidade e tipografia — baseline WCAG 2.2 AA

## Escopo

A aplicação adota WCAG 2.2 nível AA como referência para os critérios aplicáveis ao produto web. A conformidade não deve ser declarada apenas com base em testes automatizados: axe/Playwright cobre regressões detectáveis por máquina, enquanto navegação com leitor de tela, zoom, text spacing e fluxos autenticados continuam exigindo validação humana.

## Regras obrigatórias

- Texto normal deve manter contraste mínimo de 4,5:1; texto grande segue os limites WCAG aplicáveis.
- Limites visuais necessários para identificar inputs e outros componentes devem manter contraste mínimo de 3:1 em relação à superfície adjacente.
- Todo controle interativo precisa ser operável por teclado e apresentar foco visível.
- O shell autenticado fornece link “Pular para o conteúdo principal” e landmark `main` focalizável.
- Erros de formulário devem estar associados ao campo com `aria-invalid` e `aria-describedby`; após revalidação com erro remanescente, o foco deve ir para o primeiro campo que ainda exige correção.
- Mudanças de estado relevantes que não recebem foco devem usar `role="status"`/`aria-live` ou `role="alert"`, conforme urgência.
- Controles que expandem/recolhem conteúdo devem expor `aria-expanded` e `aria-controls`.
- Elementos decorativos devem ser ocultados da árvore acessível quando apropriado.
- `prefers-reduced-motion` deve continuar respeitado.

## Tipografia

- Família principal: IBM Plex Sans.
- Família monoespaçada: IBM Plex Mono, restrita principalmente a números, odds, valores e dados tabulares.
- Corpo padrão mantém 16 px do navegador com line-height base 1.5.
- Texto secundário funcional deve preferir 14 px ou mais.
- `text-xs` é elevado para 13 px/18 px de line-height.
- Metadados originalmente em 10–11 px têm piso de 12 px/16 px.
- `label-eyebrow` usa 13 px em telas amplas e 12 px em telas estreitas, com tracking reduzido.
- CTAs novos devem evitar caixa alta integral quando não houver necessidade semântica.

## Automação

O job `Browser compatibility and accessibility` instala Playwright e `@axe-core/playwright`, executando a matriz de Chromium, Firefox e WebKit já existente. As superfícies públicas são verificadas com tags WCAG A/AA, incluindo WCAG 2.2 AA, e o login recebe smoke test de teclado.

Os contratos em `src/frontend-accessibility-typography-contract.test.ts` protegem contraste fallback, associação de erros, live regions, estados de expansão, skip link e escala tipográfica.

## Validação manual ainda necessária

Antes de declarar conformidade integral WCAG 2.2 AA, validar periodicamente:

- NVDA + Firefox/Chrome em fluxo autenticado;
- VoiceOver + Safari macOS/iOS;
- TalkBack + Chrome Android;
- zoom 200% e 400%;
- text spacing conforme WCAG 1.4.12;
- ordem de foco e ausência de foco encoberto em todas as transições SPA;
- mensagens de erro e sucesso em operações reais autenticadas.
