import { BackendError } from "./backend-contract";
import { adminDb, type AdminDb } from "./admin-db";
import { parseFixtures, type FiveDollarFixture } from "./adapters/five_dollar.parse";
import { fiveDollarConfigured, fiveDollarGet } from "./adapters/five_dollar.server";
import { activeFootballProvider } from "./pipeline/provider.server";
import { callRuntimeRpc } from "./repositories/runtime-rpc.server";
import {
  saoPauloLocalDate,
  saoPauloLocalDateTimeToIso,
  saoPauloLocalDayUnixWindow,
} from "./sao-paulo-time";
import { selectScheduledFixtures, type ScheduledFixturePayload } from "./scheduled-analysis";

type ScheduledConfigRow = {
  owner_id: string;
  enabled: boolean;
  target_offset_days: number;
};

type ScheduledCreateRow = { run_id: string; reused: boolean | null };
type ScheduledEnqueueRow = { status: string; created: boolean | null };
type RetryRow = { retried: boolean | null; status: string | null };

type ExistingJob = {
  status: string;
};

type ExistingRun = {
  status: string;
  notes: Record<string, unknown> | null;
};

function firstRow<T>(value: T[] | T | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function payloadHasMore(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return false;
  const pagination = (payload as { pagination?: unknown }).pagination;
  return Boolean(
    typeof pagination === "object"
      && pagination !== null
      && (pagination as { has_more?: unknown }).has_more === true,
  );
}

function validateLocalTime(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BackendError("VALIDATION_ERROR", "Horário mínimo inválido.", 400);
  }
  return value;
}

async function fetchFixturesForLocalDate(targetDate: string): Promise<FiveDollarFixture[]> {
  const { start, end } = saoPauloLocalDayUnixWindow(targetDate);
  const fixtures: FiveDollarFixture[] = [];

  for (let page = 1; page <= 50; page += 1) {
    const response = await fiveDollarGet(
      `/fixtures?start_time=${start}&end_time=${end}&include=odds&page=${page}&per_page=100`,
    );
    if (response.status !== "OK" || response.payload === null) {
      if (response.status === "RATE_LIMITED") {
        throw new BackendError("RATE_LIMITED", "A fonte de jogos atingiu o limite temporário. Tente novamente em instantes.", 429);
      }
      throw new BackendError(
        "UPSTREAM_UNAVAILABLE",
        "Não foi possível consultar os jogos de hoje agora.",
        503,
      );
    }

    fixtures.push(...parseFixtures(response.payload));
    if (!payloadHasMore(response.payload)) break;
  }

  return fixtures;
}

async function allowedCompetitionIds(db: AdminDb) {
  const [domestic, cross] = await Promise.all([
    db.from("elo_target_leagues").select("league_id").eq("active", true),
    db.from("elo_cross_competitions").select("competition_id").eq("active", true),
  ]);
  if (domestic.error || cross.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar os campeonatos autorizados.", 500);
  }
  return new Set<number>([
    ...(domestic.data ?? []).map((row) => Number(row.league_id)),
    ...(cross.data ?? []).map((row) => Number(row.competition_id)),
  ].filter(Number.isFinite));
}

async function kickWorker(db: AdminDb) {
  const { error } = await callRuntimeRpc<number | null>(db, "kick_analysis_worker");
  if (error) {
    throw new BackendError("INTERNAL_ERROR", "A análise foi preparada, mas o worker não pôde ser acionado.", 500);
  }
}

async function ensureJob(db: AdminDb, ownerId: string, runId: string) {
  const jobResult = await db
    .from("analysis_jobs")
    .select("status")
    .eq("run_id", runId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (jobResult.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível verificar a fila da análise.", 500);
  }
  const job = jobResult.data as ExistingJob | null;

  if (job?.status === "DONE") return { status: "DONE", created: false };
  if (job?.status === "ERROR") {
    const retry = await callRuntimeRpc<RetryRow[] | RetryRow>(db, "retry_analysis_job_atomic", {
      p_run_id: runId,
      p_user_id: ownerId,
    });
    const row = firstRow(retry.data);
    if (retry.error || row?.retried !== true) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível retomar a análise de hoje.", 500);
    }
    await kickWorker(db);
    return { status: row.status ?? "QUEUED", created: false };
  }
  if (job?.status === "QUEUED" || job?.status === "RUNNING") {
    await kickWorker(db);
    return { status: job.status, created: false };
  }

  const enqueue = await callRuntimeRpc<ScheduledEnqueueRow[] | ScheduledEnqueueRow>(
    db,
    "enqueue_scheduled_analysis_job_atomic",
    { p_run_id: runId, p_user_id: ownerId },
  );
  const row = firstRow(enqueue.data);
  if (enqueue.error || !row) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível colocar a análise de hoje na fila.", 500);
  }
  await kickWorker(db);
  return { status: row.status || "QUEUED", created: Boolean(row.created) };
}

async function annotateOnDemandRun(db: AdminDb, runId: string, afterLocalTime: string) {
  const runResult = await db.from("analysis_runs").select("status,notes").eq("id", runId).single();
  if (runResult.error || !runResult.data) {
    throw new BackendError("INTERNAL_ERROR", "A análise foi criada, mas não pôde ser identificada.", 500);
  }
  const run = runResult.data as ExistingRun;
  const notes = run.notes && typeof run.notes === "object" ? run.notes : {};
  const update = await db.from("analysis_runs").update({
    notes: {
      ...notes,
      on_demand: true,
      target_offset_days: 0,
      requested_after_local_time: afterLocalTime,
      on_demand_requested_at: new Date().toISOString(),
    },
  }).eq("id", runId);
  if (update.error) {
    throw new BackendError("INTERNAL_ERROR", "A análise foi criada, mas o contexto do pedido não pôde ser salvo.", 500);
  }
  return run.status;
}

async function createRun(
  db: AdminDb,
  ownerId: string,
  targetDate: string,
  fixtures: ScheduledFixturePayload[],
) {
  const created = await callRuntimeRpc<ScheduledCreateRow[] | ScheduledCreateRow>(
    db,
    "create_scheduled_analysis_run_atomic",
    { p_owner_id: ownerId, p_target_date: targetDate, p_fixtures: fixtures },
  );
  const row = firstRow(created.data);
  if (created.error || !row?.run_id) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível criar a análise dos jogos de hoje.", 500);
  }
  return { runId: row.run_id, reused: Boolean(row.reused) };
}

export async function runSameDayOnDemandAnalysis(afterLocalTime: string, now = new Date()) {
  const cutoff = validateLocalTime(afterLocalTime);
  const targetDate = saoPauloLocalDate(now);
  const db = await adminDb();

  const configResult = await callRuntimeRpc<ScheduledConfigRow[] | ScheduledConfigRow>(
    db,
    "get_scheduled_daily_analysis_config",
  );
  const config = firstRow(configResult.data);
  if (configResult.error || !config?.enabled) {
    throw new BackendError("INTERNAL_ERROR", "A análise automática não está habilitada.", 500);
  }
  if (activeFootballProvider() !== "five_dollar" || !fiveDollarConfigured()) {
    throw new BackendError(
      "UPSTREAM_UNAVAILABLE",
      "A análise exige o provedor 5Dollar configurado no servidor.",
      503,
    );
  }

  const allowedIds = await allowedCompetitionIds(db);
  const providerFixtures = await fetchFixturesForLocalDate(targetDate);
  const cutoffMs = Date.parse(saoPauloLocalDateTimeToIso(targetDate, cutoff));
  const fixtures = selectScheduledFixtures(providerFixtures, allowedIds)
    .filter((fixture) => Date.parse(fixture.kickoff_at) >= cutoffMs);

  if (fixtures.length === 0) {
    return {
      status: "NO_ELIGIBLE_FIXTURES" as const,
      targetDate,
      afterLocalTime: cutoff,
      runId: null,
      fixtures: 0,
      providerFixtures: providerFixtures.length,
    };
  }

  const created = await createRun(db, config.owner_id, targetDate, fixtures);
  const runStatus = await annotateOnDemandRun(db, created.runId, cutoff);
  if (runStatus === "READY_FOR_ODDS" || runStatus === "COMPLETED") {
    return {
      status: "READY" as const,
      targetDate,
      afterLocalTime: cutoff,
      runId: created.runId,
      fixtures: fixtures.length,
      providerFixtures: providerFixtures.length,
      reused: true,
    };
  }

  const job = await ensureJob(db, config.owner_id, created.runId);
  return {
    status: created.reused ? ("RESUMED" as const) : ("QUEUED" as const),
    targetDate,
    afterLocalTime: cutoff,
    runId: created.runId,
    fixtures: fixtures.length,
    providerFixtures: providerFixtures.length,
    reused: created.reused,
    jobStatus: job.status,
  };
}
