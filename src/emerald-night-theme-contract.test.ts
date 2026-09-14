import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function styles() {
  return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

describe("Emerald Night visual contract", () => {
  it("keeps the interface night-first with the approved emerald palette", () => {
    const css = styles();

    expect(css).toContain("--background: #08110f;");
    expect(css).toContain("--surface: #111e1a;");
    expect(css).toContain("--card: #111e1a;");
    expect(css).toContain("--primary: #2dd4a3;");
    expect(css).toContain("--accent: #3be0b1;");
    expect(css).toContain("--border: #243b32;");
    expect(css).toContain("--muted-foreground: #94afa5;");
  });

  it("reserves red and amber for semantic states instead of decorative accents", () => {
    const css = styles();

    expect(css).toContain("--destructive: #f87171;");
    expect(css).toContain("--warning: #fbbf24;");
    expect(css).toContain("--success: #3be0b1;");
    expect(css).not.toContain("#8a6ef2");
    expect(css).not.toContain("#55cbe5");
  });

  it("preserves dark color scheme, accessible focus ring and reduced motion", () => {
    const css = styles();

    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("outline: 2px solid var(--color-ring);");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
