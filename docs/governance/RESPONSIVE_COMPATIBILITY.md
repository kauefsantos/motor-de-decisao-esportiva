# Responsividade e compatibilidade

## Escopo suportado

O frontend deve permanecer funcional e legível em celular, tablet e computador, com interação por mouse, teclado e toque. A política mínima de navegadores está versionada em `.browserslistrc`.

### Matriz automatizada

O CI executa smoke tests reais com Playwright em:

- Chromium desktop — 1366×768;
- Firefox desktop — 1366×768;
- WebKit desktop — 1366×768;
- WebKit mobile — 375×667 e 390×844;
- Chromium mobile — 412×915;
- WebKit tablet — 768×1024 e 1024×768.

Os testes verificam carregamento, ausência de overflow horizontal nas superfícies públicas, tamanho mínimo dos principais alvos de toque e possibilidade de uso em retrato e paisagem.

## Regras de interface

1. Em ponteiros `coarse`, controles de ação devem manter alvo mínimo de 44×44 px, mesmo quando breakpoints `sm` ou `md` estiverem ativos.
2. `safe-area-inset-*` deve ser preservado em cabeçalho, navegação inferior e telas de autenticação.
3. A navegação inferior móvel deve ser ocultada enquanto o teclado virtual reduz o `visualViewport`, evitando sobreposição dos campos.
4. Inputs numéricos devem usar teclado decimal/numeric adequado e `enterKeyHint` coerente.
5. Correções de data e horário devem usar controles nativos `date` e `time` quando esses campos forem editáveis.
6. Tabelas densas ficam restritas a telas grandes; tablets usam a representação em cards.
7. Popovers de ajuda devem ficar dentro do viewport e usar apresentação fixa tipo bottom sheet em dispositivos de toque.
8. O `body` não deve esconder overflow horizontal como correção genérica. Componentes que extrapolarem a largura devem ser corrigidos na origem ou ter scroll local explícito.
9. Cores modernas (`oklch`/`color-mix`) devem possuir fallback seguro para browsers fora da baseline.
10. Mensagens de compatibilidade devem ser neutras entre iOS, Android e desktop, citando requisitos específicos apenas quando necessário.

## Teste físico

A matriz automatizada reduz regressões, mas não substitui a validação periódica em aparelho real, especialmente para:

- teclado virtual e redimensionamento do viewport no Safari iOS;
- instalação PWA e notificações no iPhone/iPad;
- teclado virtual e permissões de notificação no Chrome Android;
- rotação real de tablet;
- comportamento de zoom/acessibilidade do sistema.

Esses itens devem ser tratados como validação de dispositivo e não como justificativa para omitir os gates automatizados do CI.
