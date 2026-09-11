import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("background analysis contract", () => {
  it("queues the server job before leaving the upload screen", () => {
    const upload = source("./routes/index.tsx");
    const enqueueAt = upload.indexOf("await enqueue({ data: { runId: res.runId } })");
    const navigateAt = upload.indexOf('navigate({ to: "/run/$runId/processamento"');
    expect(enqueueAt).toBeGreaterThan(-1);
    expect(navigateAt).toBeGreaterThan(enqueueAt);
  });

  it("observes persisted progress instead of executing pipeline steps in the phone", () => {
    const processing = source("./routes/run.$runId.processamento.tsx");
    expect(processing).toContain("getProcessingStatus");
    expect(processing).toContain("refetchInterval");
    expect(processing).toContain("PushNotificationControl");
    expect(processing).not.toContain("runStep");
    expect(processing).not.toContain("for (const step of PIPELINE_STEPS)");
  });

  it("executes one pipeline step per protected worker invocation and chains the next", () => {
    const worker = source("./routes/api.analysis-worker.ts");
    expect(worker).toContain("claim_analysis_job");
    expect(worker).toContain("PIPELINE_STEPS.find");
    expect(worker).toContain("await executeStep(runId, nextStep.key)");
    expect(worker).toContain('status: "QUEUED"');
    expect(worker).toContain('db.rpc("kick_analysis_worker")');
    expect(worker).toContain("sendAnalysisReadyPush");
  });

  it("persists queue state and retries stalled work with pg_cron + pg_net", () => {
    const migration = source("../supabase/migrations/20260911170500_background_analysis_push.sql");
    expect(migration).toContain("create table if not exists public.analysis_jobs");
    expect(migration).toContain("dispatch_token uuid");
    expect(migration).toContain("net.http_post");
    expect(migration).toContain("analysis-worker-watch");
    expect(migration).toContain("locked_at < now() - interval '20 minutes'");
  });
});

describe("iPhone Web Push contract", () => {
  it("asks notification permission only from the explicit activation action", () => {
    const control = source("./components/PushNotificationControl.tsx");
    expect(control).toContain("async function enable()");
    expect(control).toContain("Notification.requestPermission()");
    expect(control).toContain("Ativar notificações");
  });

  it("registers a service worker that always shows a visible push notification", () => {
    const client = source("./lib/push.client.ts");
    const worker = source("../public/sw.js");
    expect(client).toContain('register("/sw.js"');
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('showNotification("Análise pronta"');
    expect(worker).toContain('addEventListener("notificationclick"');
  });

  it("keeps the push signing secret server-side and exposes only the VAPID public key", () => {
    const pushServer = source("./lib/push.server.ts");
    const pushFunctions = source("./lib/push.functions.ts");
    expect(pushServer).toContain('process.env["SUPABASE_SERVICE_ROLE_KEY"]');
    expect(pushServer).toContain("bet-value-web-push-v1");
    expect(pushFunctions).toContain("getVapidPublicKey()");
    expect(pushFunctions).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("gives the installed web app a stable manifest identity", () => {
    const manifest = JSON.parse(source("../public/site.webmanifest"));
    expect(manifest.id).toBe("/");
    expect(manifest.display).toBe("standalone");
  });
});
