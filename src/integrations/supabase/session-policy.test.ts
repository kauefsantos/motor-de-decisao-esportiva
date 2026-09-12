import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  authenticationTimestampFromClaims,
  isAuthenticationFresh,
} from "./session-policy";

const NOW = 1_800_000_000;

describe("absolute session age", () => {
  it("accepts a fresh OAuth authentication", () => {
    const claims = {
      amr: [{ method: "oauth", timestamp: NOW - 60 }],
    };
    expect(isAuthenticationFresh(claims, NOW)).toBe(true);
  });

  it("expires exactly at the 30-day absolute limit", () => {
    const claims = {
      amr: [{ method: "oauth", timestamp: NOW - SESSION_MAX_AGE_SECONDS }],
    };
    expect(isAuthenticationFresh(claims, NOW)).toBe(false);
  });

  it("does not let token refresh restart an old OAuth session", () => {
    const claims = {
      amr: [
        { method: "oauth", timestamp: NOW - SESSION_MAX_AGE_SECONDS - 1 },
        { method: "token_refresh", timestamp: NOW - 5 },
      ],
    };
    expect(authenticationTimestampFromClaims(claims)).toBe(
      NOW - SESSION_MAX_AGE_SECONDS - 1,
    );
    expect(isAuthenticationFresh(claims, NOW)).toBe(false);
  });

  it("accepts the OAuth provider authorization-code method", () => {
    const claims = {
      amr: [
        {
          method: "oauth_provider/authorization_code",
          timestamp: NOW - 120,
        },
      ],
    };
    expect(isAuthenticationFresh(claims, NOW)).toBe(true);
  });

  it("fails closed when no signed OAuth authentication timestamp exists", () => {
    expect(
      isAuthenticationFresh(
        { amr: [{ method: "token_refresh", timestamp: NOW - 1 }] },
        NOW,
      ),
    ).toBe(false);
    expect(isAuthenticationFresh({}, NOW)).toBe(false);
  });

  it("rejects implausible future authentication timestamps", () => {
    const claims = {
      amr: [{ method: "oauth", timestamp: NOW + 10 * 60 }],
    };
    expect(isAuthenticationFresh(claims, NOW)).toBe(false);
  });
});
