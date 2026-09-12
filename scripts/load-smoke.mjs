import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const port = 4174;
const url = `http://127.0.0.1:${port}/privacidade`;
const child = spawn("bun", ["run", "dev", "--host", "127.0.0.1", "--port", String(port)], {
  stdio: "ignore",
  env: { ...process.env, CI: "1" },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Servidor não ficou disponível em 30s.");
}

async function oneRequest() {
  const started = performance.now();
  const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - started };
}

try {
  await waitForServer();
  for (let i = 0; i < 3; i += 1) await oneRequest();

  const results = [];
  const total = 60;
  const concurrency = 10;
  for (let offset = 0; offset < total; offset += concurrency) {
    const batch = await Promise.all(Array.from({ length: Math.min(concurrency, total - offset) }, oneRequest));
    results.push(...batch);
  }

  const errors = results.filter((r) => r.status < 200 || r.status >= 400);
  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] ?? 0;
  const p50 = percentile(0.5);
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);

  console.log(`Load smoke: ${total} requests, concurrency=${concurrency}, errors=${errors.length}, p50=${p50.toFixed(1)}ms, p95=${p95.toFixed(1)}ms, p99=${p99.toFixed(1)}ms`);

  if (errors.length > 0) throw new Error(`Load smoke encontrou ${errors.length} respostas de erro.`);
  if (p95 > 1_200) throw new Error(`p95 ${p95.toFixed(1)}ms excedeu orçamento de 1200ms.`);
} finally {
  child.kill("SIGTERM");
  await sleep(250);
  if (!child.killed) child.kill("SIGKILL");
}