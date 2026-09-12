import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = rgb.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("WCAG 2.2 AA accessibility and typography contract", () => {
  it("keeps primary and destructive button text at AA contrast in fallback colors", () => {
    expect(contrast("#8a6ef2", "#101118")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#e1645a", "#101118")).toBeGreaterThanOrEqual(4.5);
    const styles = source("./styles.css");
    expect(styles).toContain("--primary-foreground: #101118");
    expect(styles).toContain("--destructive-foreground: #101118");
    expect(styles).toContain("--primary-foreground: oklch(0.14 0.018 272)");
    expect(styles).toContain("--destructive-foreground: oklch(0.14 0.018 272)");
  });

  it("keeps unfocused input boundaries above the non-text contrast floor", () => {
    expect(contrast("#70768f", "#202230")).toBeGreaterThanOrEqual(3);
    const styles = source("./styles.css");
    expect(styles).toContain("--input: #70768f");
    expect(styles).toContain("--input: oklch(0.55 0.035 273)");
  });

  it("associates validation errors with the affected fields and focuses remaining errors", () => {
    const validation = source("./routes/draft.$draftId.validacao.tsx");
    expect(validation).toContain("aria-invalid={matchingErrors.length > 0 || undefined}");
    expect(validation).toContain("aria-describedby={describedBy}");
    expect(validation).toContain("fieldErrorId(game.id, item.field, index)");
    expect(validation).toContain("focusFirstInvalid");
    expect(validation).toContain("document.getElementById(fieldInputId");
  });

  it("announces dynamic notification and validation status changes", () => {
    const push = source("./components/PushNotificationControl.tsx");
    const validation = source("./routes/draft.$draftId.validacao.tsx");
    expect(push).toContain('role="status" aria-live="polite"');
    expect(push).toContain('role={state === "error" ? "alert" : undefined}');
    expect(validation).toContain('role="status" aria-live="polite"');
  });

  it("exposes expandable decision details programmatically", () => {
    const queue = source("./components/DecisionQueueFlow.tsx");
    expect(queue).toContain("aria-expanded={open}");
    expect(queue).toContain("aria-controls={detailId}");
    expect(queue).toContain("id={detailId}");
  });

  it("provides a keyboard bypass link and a focusable main landmark", () => {
    const shell = source("./components/AppShell.tsx");
    const styles = source("./styles.css");
    expect(shell).toContain('href="#conteudo-principal"');
    expect(shell).toContain('id="conteudo-principal" tabIndex={-1}');
    expect(styles).toContain(".skip-link");
    expect(styles).toContain(".skip-link:focus-visible");
  });

  it("runs axe WCAG checks in the cross-browser CI matrix", () => {
    const workflow = source("../.github/workflows/ci.yml");
    const browserTest = source("../tests/browser/accessibility.pw.ts");
    expect(workflow).toContain("@axe-core/playwright@4.10.2");
    expect(workflow).toContain("Responsive and accessibility browser matrix");
    expect(browserTest).toContain('withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])');
    expect(browserTest).toContain("login surface supports keyboard-only activation");
  });

  it("raises the typography floor for metadata while preserving the type families", () => {
    const styles = source("./styles.css");
    expect(styles).toContain('--font-sans: "IBM Plex Sans"');
    expect(styles).toContain('--font-mono: "IBM Plex Mono"');
    expect(styles).toContain("font-size: 0.8125rem");
    expect(styles).toContain(".text-xs");
    expect(styles).toContain("font-size: 0.75rem");
    expect(styles).toContain("line-height: 1.5");
  });
});
