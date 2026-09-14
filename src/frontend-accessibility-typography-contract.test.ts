import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = rgb.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function fallbackToken(styles: string, name: string) {
  const match = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Fallback hexadecimal ausente para --${name}`);
  return match[1];
}

describe("WCAG 2.2 AA accessibility and typography contract", () => {
  it("keeps primary and destructive button text at AA contrast in fallback colors", () => {
    const styles = source("./styles.css");
    const primary = fallbackToken(styles, "primary");
    const primaryForeground = fallbackToken(styles, "primary-foreground");
    const destructive = fallbackToken(styles, "destructive");
    const destructiveForeground = fallbackToken(styles, "destructive-foreground");

    expect(contrast(primary, primaryForeground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(destructive, destructiveForeground)).toBeGreaterThanOrEqual(4.5);
    expect(styles).toContain("--primary-foreground: oklch(");
    expect(styles).toContain("--destructive-foreground: oklch(");
  });

  it("keeps unfocused input boundaries above the non-text contrast floor", () => {
    const styles = source("./styles.css");
    const input = fallbackToken(styles, "input");
    const surface = fallbackToken(styles, "surface");

    expect(contrast(input, surface)).toBeGreaterThanOrEqual(3);
    expect(styles).toContain("--input: oklch(");
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
