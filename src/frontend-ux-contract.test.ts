import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("frontend UX/UI clarity contract", () => {
  it("uses four task-oriented macro stages", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain('label: "Enviar e validar"');
    expect(shell).toContain('label: "Preparar"');
    expect(shell).toContain('label: "Conferir e escolher"');
    expect(shell).toContain('label: "Revisar e registrar"');
    expect(shell).toContain("{activeStageIndex + 1} de {STAGES.length}");
    expect(shell).not.toContain("chance do modelo <strong");
    expect(shell).not.toContain("EV mínimo de 2%");
  });

  it("turns the home into an owner-scoped action dashboard without hiding new analysis", () => {
    const home = source("./routes/index.tsx");
    const summary = source("./lib/home-summary.functions.ts");
    expect(home).toContain("O que precisa da sua atenção?");
    expect(home).toContain("Continuar análise");
    expect(home).toContain("Resultados para informar");
    expect(home).toContain("Sugestões para registrar");
    expect(home).toContain("Saldo disponível");
    expect(home).toContain("Análises recentes");
    expect(home).toContain("VALIDAR PARTIDAS");
    expect(summary).toContain('.eq("owner_id", userId)');
    expect(summary).toContain("experimental_bet_tracking");
  });

  it("makes ignored CSV rows visible before the main CTA", () => {
    const home = source("./routes/index.tsx");
    const warningIndex = home.indexOf("linha{parsed.invalid.length === 1");
    const ctaIndex = home.indexOf("VALIDAR PARTIDAS");
    expect(home).toContain("não {parsed.invalid.length === 1 ? \"será\" : \"serão\"} analisada");
    expect(home).toContain("Ver linhas ignoradas");
    expect(warningIndex).toBeGreaterThan(-1);
    expect(ctaIndex).toBeGreaterThan(warningIndex);
  });

  it("shows the resolved match and kickoff during validation", () => {
    const route = source("./routes/draft.$draftId.validacao.tsx");
    expect(route).toContain("resolved_kickoff");
    expect(route).toContain('timeZone: "America/Sao_Paulo"');
    expect(route).toContain("Encontramos:");
    expect(route).toContain("horário confirmado");
    expect(route).toContain("precisa(m) de atenção");
  });

  it("uses plain-language odds and selection copy", () => {
    const route = source("./routes/run.$runId.oportunidades.tsx");
    const flow = source("./components/DecisionQueueFlow.tsx");
    expect(route).toContain("Conferir as odds e escolher");
    expect(route).toContain("até 3 para esta rodada");
    expect(flow).toContain("Ver opções com valor");
    expect(flow).toContain("Opções com valor");
    expect(flow).toContain("Escolha até {dailyLimit} opções para esta rodada");
    expect(flow).not.toContain("AVALIAR E ABRIR FILA DE DECISÃO");
    expect(flow).not.toContain("Escolha até {dailyLimit} opções hoje");
    expect(flow).not.toContain("Cada lote mostra no máximo 10 opções reais");
  });

  it("resumes persisted decisions without repeating preparation or quotes", () => {
    const gate = source("./components/DecisionQueueGate.tsx");
    expect(gate).toContain("getDecisionQueueHistory");
    expect(gate).toContain("hasPersistedDecisionState");
    expect(gate).toContain("decisionQueueEvaluated");
    expect(gate).toContain("sem refazer modelos ou buscar as odds novamente");
    expect(gate).toContain("return <DecisionQueueFlow runId={runId} />");
  });

  it("keeps the result server-backed and places registration before exit actions", () => {
    const result = source("./routes/run.$runId.resultado.tsx");
    expect(result).toContain("getExperimentalBetPlan");
    expect(result).toContain("<BetConfirmationFlow runId={runId} />");
    expect(result).not.toContain("localStorage");
    expect(result).not.toContain("experimental-result:");
    expect(result).not.toContain("promoteQualifiedExperimentalBet");
    expect(result.indexOf("<BetConfirmationFlow runId={runId} />")).toBeLessThan(result.indexOf("Outras ações"));
  });

  it("uses decision-focused result metrics and short explanations", () => {
    const result = source("./routes/run.$runId.resultado.tsx");
    const help = source("./components/MetricHelp.tsx");
    expect(result).toContain("EV esperado");
    expect(result).toContain('MetricHelp term="EV"');
    expect(result).toContain('MetricHelp term="Odd de referência"');
    expect(result).toContain('MetricHelp term="Vantagem"');
    expect(help).toContain("Não é lucro garantido");
  });

  it("makes registration recoverable, explicit and sequential", () => {
    const confirmation = source("./components/BetConfirmationFlow.tsx");
    expect(confirmation).toContain("isError");
    expect(confirmation).toContain("Não foi possível carregar o registro das apostas");
    expect(confirmation).toContain("Tentar novamente");
    expect(confirmation).toContain("Aposta {currentNumber} de {total}");
    expect(confirmation).toContain("Saldo depois");
    expect(confirmation).toContain("Descartar esta sugestão");
    expect(confirmation).toContain("Confirmar descarte");
    expect(confirmation).not.toContain("Não registrar");
  });

  it("removes the legacy weekday 2/weekend 3 selection rule", () => {
    const legacy = source("./lib/qualified-alternates.functions.ts");
    expect(legacy).toContain("SELECTION_LIMIT_PER_TARGET_DATE = 3");
    expect(legacy).not.toContain("weekday === 0");
    expect(legacy).not.toContain("return 2");
  });

  it("keeps processing independent from the route lifecycle", () => {
    const processing = source("./routes/run.$runId.processamento.tsx");
    expect(processing).toContain("getProcessingStatus");
    expect(processing).toContain("enqueueAnalysis");
    expect(processing).toContain("idempotent");
    expect(processing).not.toContain("runStep");
  });

  it("never presents a loading failure as an empty decision result", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const result = source("./routes/run.$runId.resultado.tsx");
    expect(flow).toContain("Não foi possível carregar as opções");
    expect(flow).toContain("Sua análise continua salva");
    expect(result).toContain("Isso é uma falha de carregamento");
    expect(result).toContain("não significa que a análise terminou sem opções");
  });

  it("labels realized performance separately from expected value", () => {
    const analytics = source("./routes/analytics.tsx");
    expect(analytics).toContain("ROI realizado");
    expect(analytics).toContain("Resultado realizado");
    expect(analytics).toContain('MetricHelp term={help}');
    expect(analytics).toContain('help="CLV"');
    expect(analytics).not.toContain('label="Retorno sobre o valor apostado"');
  });

  it("requires confirmation and blocks duplicate settlement actions", () => {
    const openBets = source("./routes/open-bets.tsx");
    expect(openBets).toContain("settlingId");
    expect(openBets).toContain("Confirmar resultado");
    expect(openBets).toContain("disabled={settlingId !== null}");
    expect(openBets).toContain("A banca foi atualizada");
    expect(openBets).toContain("A banca não foi alterada");
  });
});

describe("frontend mobile-first and accessibility contract", () => {
  it("separates analysis progress from persistent navigation", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain('aria-label="Progresso da análise"');
    expect(shell).toContain('aria-label="Acompanhamento"');
    expect(shell).toContain("Em andamento");
    expect(shell).toContain("Desempenho");
  });

  it("keeps collapsible technical detail accessible", () => {
    const panel = source("./components/CollapsiblePanel.tsx");
    expect(panel).toContain("{open && (");
    expect(panel).toContain('role="region"');
    expect(panel).toContain("aria-labelledby={buttonId}");
  });

  it("keeps touch targets and mobile microcopy legible", () => {
    const input = source("./components/ui/input.tsx");
    const styles = source("./styles.css");
    expect(input).toContain("h-11");
    expect(styles).toContain("font-size: 0.75rem");
    expect(styles).toContain("min-height: 44px");
  });

  it("respects reduced motion and dynamic viewport", () => {
    const styles = source("./styles.css");
    const auth = source("./components/AuthGate.tsx");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(auth).toContain("min-h-[100dvh]");
    expect(auth).toContain("safe-area-inset-top");
    expect(auth).toContain("safe-area-inset-bottom");
  });

  it("uses a bottom navigation, leaves room for the Home Indicator, and avoids the virtual keyboard", () => {
    const shell = source("./components/AppShell.tsx");
    expect(shell).toContain('aria-label="Navegação principal"');
    expect(shell).toContain("safe-area-inset-bottom");
    expect(shell).toContain('keyboardOpen ? "hidden" : "fixed"');
    expect(shell).toContain("inset-x-0 bottom-0");
    expect(shell).toContain("window.visualViewport");
  });

  it("keeps manual odds easy to enter on narrow phone layouts", () => {
    const flow = source("./components/DecisionQueueFlow.tsx");
    const styles = source("./styles.css");
    expect(flow).toContain('className="num mt-1 w-28"');
    expect(styles).toContain("input.w-28");
    expect(styles).toContain("width: 100%");
  });

  it("uses branded icons for the installed app and in-app identity", () => {
    const root = source("./routes/__root.tsx");
    const shell = source("./components/AppShell.tsx");
    const manifest = source("../public/site.webmanifest");
    expect(root).toContain("/icons/apple-touch-icon.png");
    expect(root).toContain("/icons/favicon-32.png");
    expect(shell).toContain("/icons/favicon-32.png");
    expect(manifest).toContain("/icons/icon-192.png");
    expect(manifest).toContain("/icons/icon-512.png");
  });
});
