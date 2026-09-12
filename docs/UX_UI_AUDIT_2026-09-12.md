# Auditoria de UX/UI e clareza da interface — 12/09/2026

## Escopo

Auditoria da versão publicada do Bet Value Engine / Value Bet Finder com foco em facilidade de uso, organização visual, consistência, clareza dos textos, confirmações, quantidade de passos e prevenção de ações duplicadas.

## Achados corrigidos neste pacote

1. Progresso visual não refletia o fluxo real.
2. Resultado ativo ainda dependia de compatibilidade com `localStorage` experimental.
3. Regra legada 2 seleções em dias úteis / 3 em fim de semana ainda existia em uma rota de compatibilidade.
4. Registro de aposta aparecia depois das ações de saída do resultado.
5. Falha ao carregar o plano de registro podia desaparecer silenciosamente.
6. Etapa de odds expunha linguagem interna (`fila`, `backend`, `servidor`) no fluxo principal.
7. Texto de limite usava “hoje” em vez da rodada/data analisada.
8. Linhas ignoradas do CSV podiam ficar escondidas em detalhes.
9. “Retorno” era usado tanto para EV esperado quanto para desempenho financeiro realizado.
10. A validação não destacava claramente o horário resolvido pela fonte.
11. O registro da aposta não resumia suficientemente o impacto sobre a banca antes da confirmação.
12. O registro de várias sugestões não mostrava progresso “Aposta X de Y”.

## Correções aplicadas

- Stepper consolidado em quatro macroetapas: **Enviar e validar → Preparar → Conferir e escolher → Revisar e registrar**.
- Resultado atual totalmente recuperado do estado persistido no servidor (`getExperimentalBetPlan`), sem `localStorage` como fonte de verdade.
- Limite legado neutralizado: qualquer compatibilidade remanescente usa **3 seleções por target_date em todos os dias**.
- `BetConfirmationFlow` movido para dentro da etapa de resultado, antes de “Nova análise”, “Em andamento” e “Desempenho”.
- Erro explícito + retry no carregamento do registro.
- Linguagem principal da etapa de odds simplificada para “Opções com valor” e CTA “VER OPÇÕES COM VALOR”.
- Limite descrito como “até 3 opções para esta rodada”.
- CSV com linhas ignoradas exibe alerta antes do CTA e motivos expansíveis.
- Resultado usa **EV esperado**; analytics usa **ROI realizado / Resultado realizado**.
- Validação mostra partida encontrada, competição e horário confirmado em `America/Sao_Paulo`.
- Registro mostra odd, EV esperado, valor, saldo após o registro e confirmação explícita para descarte.
- Registro múltiplo mostra **Aposta X de Y**.
- CTAs assíncronos continuam bloqueados durante execução e liquidação mantém confirmação em duas etapas.

## 16 melhorias de produto/UX implementadas

1. Resumo contextual nas etapas principais.
2. Progresso orientado à tarefa.
3. Próxima ação priorizada visualmente.
4. Resultado em formato de decisão: jogo, mercado, odd, chance e EV.
5. Ajuda curta para EV, odd de referência, vantagem, CLV e ROI.
6. Modo simples por padrão; detalhes técnicos em painéis colapsáveis.
7. Resumo antes de registrar aposta.
8. Indicador “X de 4” no progresso.
9. Melhor UX para CSV com erros/linhas ignoradas.
10. Análises recentes na home com retomada.
11. Retomada de análise pendente em destaque.
12. Integrações/API removidas da narrativa principal e mantidas em detalhes/diagnóstico.
13. Feedback de sucesso/erro descrevendo efeito da ação.
14. “Não registrar” substituído por descarte explícito com confirmação.
15. Home transformada em dashboard leve com pendências e saldo.
16. Central compacta “Agora” com análise para continuar, resultados pendentes e sugestões para registrar.

## Melhoria visual transversal

O pacote reduz aninhamento de cards em várias telas: métricas e detalhes passam a usar divisores, listas e espaçamento dentro de um único painel por assunto sempre que possível. Identidade dark, tipografia, navegação mobile inferior, safe areas e alvos de toque foram preservados.

## Prevenção de processamento duplicado

- Upload continua criando rascunho idempotente.
- Finalização da validação mantém chave idempotente por rascunho.
- Tela de processamento pode verificar/enfileirar novamente apenas por operação atômica/idempotente.
- Estado da decisão é recuperado antes de qualquer nova preparação/cotação.
- Avaliação com zero opções continua persistida e não é repetida após reload.
- Liquidação de aposta bloqueia novo clique enquanto a operação está em andamento e exige confirmação explícita.

## Validação esperada antes do merge

- `frontend-ux-contract.test.ts` atualizado para os novos contratos.
- Unit tests completos.
- Testes de banco/regressão.
- E2E funcional.
- E2E do motor.
- Build de produção.
- Secret scan e dependency gate.

## Limites da auditoria

A auditoria de código consegue validar estados, regras, responsividade contratual e fluxos de erro. A percepção visual final em dispositivos físicos, uso com leitor de tela real e o clique manual completo de uma sessão autenticada devem ser tratados como smoke pós-deploy. Esses testes não substituem os gates automatizados e não devem ser alegados como executados sem um navegador/dispositivo autenticado.
