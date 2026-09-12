import { describe, expect, it } from "vitest";

import { isTransientHttpStatus, retryDelayMs } from "./http-retry";

describe("HTTP transient retry policy", () => {
  it("retries only temporary transport/server statuses", () => {
    for (const code of [408, 425, 500, 502, 503, 504]) expect(isTransientHttpStatus(code)).toBe(true);
    for (const code of [400, 401, 403, 404, 409, 422, 429]) expect(isTransientHttpStatus(code)).toBe(false);
  });

  it("uses bounded exponential backoff with jitter", () => {
    expect(retryDelayMs(1, () => 0)).toBe(350);
    expect(retryDelayMs(2, () => 0)).toBe(700);
    expect(retryDelayMs(3, () => 0)).toBe(1400);
    expect(retryDelayMs(10, () => 1)).toBeLessThanOrEqual(5000);
  });
});
