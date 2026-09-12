import { describe, expect, it } from "vitest";

import { isTrustedPushEndpoint } from "./push-endpoint";

describe("Web Push endpoint SSRF boundary", () => {
  it.each([
    "https://web.push.apple.com/QKC123/example",
    "https://fcm.googleapis.com/fcm/send/example",
    "https://updates.push.services.mozilla.com/wpush/v2/example",
    "https://updates-123.push-456.services.mozilla.com/wpush/v2/example",
  ])("accepts provider-owned HTTPS endpoint %s", (endpoint) => {
    expect(isTrustedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://web.push.apple.com/example",
    "http://127.0.0.1:8080/internal",
    "https://127.0.0.1/internal",
    "https://localhost/internal",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/internal",
    "https://web.push.apple.com.evil.example/example",
    "https://evil.example/push/example",
    "https://user:pass@web.push.apple.com/example",
    "https://web.push.apple.com:8443/example",
    "https://web.push.apple.com/",
  ])("rejects untrusted destination %s", (endpoint) => {
    expect(isTrustedPushEndpoint(endpoint)).toBe(false);
  });
});
