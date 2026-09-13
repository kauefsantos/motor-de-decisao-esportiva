import { afterEach, describe, expect, it } from "vitest";

import { makeVapidAuthorization } from "./push.server";

const previousCronSecret = process.env["LOVABLE_CRON_SECRET"];

afterEach(() => {
  if (previousCronSecret === undefined) {
    delete process.env["LOVABLE_CRON_SECRET"];
  } else {
    process.env["LOVABLE_CRON_SECRET"] = previousCronSecret;
  }
});

describe("VAPID signing runtime compatibility", () => {
  it("signs a VAPID authorization header without passing a KeyObject to crypto.sign", () => {
    process.env["LOVABLE_CRON_SECRET"] = "test-only-vapid-root-secret";

    const result = makeVapidAuthorization("https://web.push.apple.com/Q-test-subscription");

    expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.authorization).toContain("vapid t=");
    expect(result.authorization).toContain(`, k=${result.publicKey}`);

    const match = /^vapid t=([^,]+), k=/.exec(result.authorization);
    expect(match).not.toBeNull();
    const token = match?.[1] ?? "";
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))).toBe(true);
  });
});
