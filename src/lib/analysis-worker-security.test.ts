import { describe, expect, it } from "vitest";

import {
  createFixedWindowRequestLimiter,
  readBoundedJsonObject,
} from "./analysis-worker-security";

describe("analysis worker request hardening", () => {
  it("accepts a small JSON object", async () => {
    const request = new Request("https://example.test/api/analysis-worker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "11111111-1111-4111-8111-111111111111",
        dispatchToken: "22222222-2222-4222-8222-222222222222",
      }),
    });

    const payload = await readBoundedJsonObject(request);
    expect(payload?.["runId"]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects non-JSON content before parsing", async () => {
    const request = new Request("https://example.test/api/analysis-worker", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });

    await expect(readBoundedJsonObject(request)).resolves.toBeNull();
  });

  it("rejects a streamed body once it exceeds the byte limit", async () => {
    const request = new Request("https://example.test/api/analysis-worker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(2048) }),
    });

    await expect(readBoundedJsonObject(request, 128)).resolves.toBeNull();
  });

  it("rate limits repeated requests from the same client key", async () => {
    const limit = createFixedWindowRequestLimiter({ limit: 2, windowMs: 1_000 });
    const makeRequest = (ip: string) =>
      new Request("https://example.test/api/analysis-worker", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
      });

    expect(limit(makeRequest("203.0.113.10"), 1_000)).toBeNull();
    expect(limit(makeRequest("203.0.113.10"), 1_100)).toBeNull();

    const blocked = limit(makeRequest("203.0.113.10"), 1_200);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("1");

    expect(limit(makeRequest("203.0.113.11"), 1_200)).toBeNull();
    expect(limit(makeRequest("203.0.113.10"), 2_001)).toBeNull();
  });
});
