import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("background analysis contract", () => {
  it("creates an idempotent draft first and queues only after validation finalizes", () => {
    const upload = source("./routes/index.tsx");
    const validation = source("./routes/draft.$draftId.validacao.tsx");
    const draftFunctions = source("./lib/analysis-draft.functions.ts");

    expect(upload).toContain("createAnalysisDraft");
    expect(upload).toContain('navigate({ to: "/draft/$draftId/validacao"');
    expect(upload).not.toContain("enqueueAnalysis");

    const finalizeAt = validation.indexOf("await finalizeDraft({");
    const navigateAt = validation.indexOf('navigate({ to: "/run/$runId/processamento"');
    expect(finalizeAt).toBeGreaterThan(-1);
    expect(navigateAt).toBeGreaterThan(finalizeAt);
    expect(draftFunctions).toContain('db.rpc("enqueue_analysis_job_atomic"');
    expect(draftFunctions).toContain('db.rpc("kick_analysis_worker")');
  });

  it("observes persisted progress instead of executing pipeline steps in the phone", () => {
    const processing = source("./routes/run.$runId.processamento.tsx");
    expect(processing).toContain("getProcessingStatus");
    expect(processing).toContain("refetchInterval");
    expect(processing).toContain("PushNotificationControl");
    expect(processing).not.toContain("runStep");
    expect(processing).not.toContain("for (const step of PIPELINE_STEPS)");
  });

  it("executes one pipeline step per protected leased worker invocation and chains the next", () => {
    const worker = source("./routes/api.analysis-worker.ts");
    expect(worker).toContain("claim_analysis_job");
    expect(worker).toContain("lease_token");
    expect(worker).toContain("heartbeat_analysis_job");
    expect(worker).toContain("start_analysis_job_step_atomic");
    expect(worker).toContain("complete_analysis_job_step_atomic");
    expect(worker).toContain("fail_analysis_job_atomic");
    expect(worker).toContain("PIPELINE_STEPS.find");
    expect(worker).toContain("await executeStep(runId, nextStep.key)");
    expect(worker).toContain('callAdminRuntimeRpc("kick_analysis_worker")');
    expect(worker).not.toContain('db.rpc("kick_analysis_worker")');
    expect(worker).toContain("enqueue_push_delivery_event");
    expect(worker).toContain("kick_push_delivery_dispatcher");
    expect(worker).not.toContain("sendAnalysisReadyPush");
  });

  it("persists queue state and recovers stalled work with renewable leases", () => {
    const original = source("../supabase/migrations/20260911170500_background_analysis_push.sql");
    const resilience = source("../supabase/migrations/20260912070000_integrations_automation_resilience.sql");
    expect(original).toContain("create table if not exists public.analysis_jobs");
    expect(original).toContain("dispatch_token uuid");
    expect(resilience).toContain("lease_token uuid");
    expect(resilience).toContain("lease_expires_at timestamptz");
    expect(resilience).toContain("heartbeat_analysis_job");
    expect(resilience).toContain("net.http_post");
    expect(resilience).toContain("analysis-worker-watch");
    expect(resilience).toContain("j.lease_expires_at<pg_catalog.now()");
    expect(resilience).toContain("set search_path=''");
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
    const client = source("./lib/push.browser.ts");
    const worker = source("../public/sw.js");
    expect(client).toContain('register("/sw.js"');
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('showNotification("Análise pronta"');
    expect(worker).toContain('addEventListener("notificationclick"');
  });

  it("keeps signing secrets server-side while durable delivery state stays server-only", () => {
    const pushServer = source("./lib/push.server.ts");
    const pushFunctions = source("./lib/push.functions.ts");
    const dispatcher = source("./routes/api.push-dispatch.ts");
    const resilience = source("../supabase/migrations/20260912070000_integrations_automation_resilience.sql");
    const privilegedDbSecretName = "SUPABASE_" + "SERVICE_ROLE_KEY";
    expect(pushServer).toContain('process.env["LOVABLE_CRON_SECRET"]');
    expect(pushServer).toContain("bet-value-web-push-v1");
    expect(pushServer).toContain("PUSH_TIMEOUT_MS");
    expect(pushServer).toContain('privateKey.export({ format: "pem", type: "pkcs8" })');
    expect(pushServer).toContain("key: privateKeyPem");
    expect(pushServer).not.toContain("key: privateKey, dsaEncoding");
    expect(pushFunctions).toContain("getVapidPublicKey()");
    expect(pushFunctions).not.toContain("LOVABLE_CRON_SECRET");
    expect(pushFunctions).not.toContain(privilegedDbSecretName);
    expect(dispatcher).toContain("claim_push_delivery_batch");
    expect(resilience).toContain("create table if not exists public.push_delivery_outbox");
    expect(resilience).toContain("revoke all on public.push_delivery_outbox from public,anon,authenticated");
  });

  it("gives the installed web app a stable manifest identity", () => {
    const manifest = JSON.parse(source("../public/site.webmanifest"));
    expect(manifest.id).toBe("/");
    expect(manifest.display).toBe("standalone");
  });
});
