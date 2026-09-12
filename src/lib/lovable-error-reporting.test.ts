import { describe, expect, it } from "vitest";

import { redactPrivacySensitiveText, sanitizePrivacyTelemetry } from "./lovable-error-reporting";

describe("privacy telemetry redaction", () => {
  it("removes emails, bearer tokens, UUIDs and push endpoints", () => {
    const input = [
      "user@example.com",
      "Bearer eyJhbGciOiJIUzI1NiJ9.abc.def",
      "11111111-1111-4111-8111-111111111111",
      "https://web.push.apple.com/Q123456789/abcdef",
    ].join(" | ");

    const result = redactPrivacySensitiveText(input);
    expect(result).not.toContain("user@example.com");
    expect(result).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(result).not.toContain("web.push.apple.com/Q123456789");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9.abc.def");
    expect(result).toContain("[email]");
    expect(result).toContain("[uuid]");
  });

  it("redacts sensitive context keys recursively", () => {
    const result = sanitizePrivacyTelemetry({
      route: "/run/11111111-1111-4111-8111-111111111111/resultado",
      authorization: "Bearer secret",
      nested: { email: "user@example.com", safe: "ok" },
    }) as Record<string, unknown>;

    expect(result.authorization).toBe("[redacted]");
    expect(result.route).toBe("/run/[uuid]/resultado");
    expect(result.nested).toEqual({ email: "[redacted]", safe: "ok" });
  });
});
