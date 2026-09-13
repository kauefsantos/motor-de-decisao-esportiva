import { BackendError } from "./backend-contract";
import { adminDb, type AdminDb } from "./admin-db";
import { parseFixtures, type FiveDollarFixture } from "./adapters/five_dollar.parse";
import { fiveDollarConfigured, fiveDollarGet } from "./adapters/five_dollar.server";
import { activeFootballProvider } from "./pipeline/provider.server";
import { callRuntimeRpc } from "./repositories/runtime-rpc.server";
import { saoPauloLocalDayUnixWindow } from "./sao-paulo-time";
import { scheduledTargetDate, selectScheduledFixtures, type ScheduledFixturePayload } from "./scheduled-analysis";

type ScheduledConfigRow = {
  owner_id: string;
  enabled: boolean;
  target_offset_days: number;
};

type ScheduledStateRow = {
  run_id: string;
  run_status: string;
  job_status: string | null;
};

type ScheduledCreateRow = { run_id: string; reused: boolean | null };
type ScheduledEnqueueRow = { status: string; created: boolean | null };
type RetryRow = { retried: boolean | null; status: string | null };

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

async function fetchFixturesForLocalDate(targetDate: string): Promise<FiveDollarFixture[]> {
  const { start, end } = saoPauloLocalDayUnixWindow(targetDate);
  const fixtures: FiveDollarFixture[] = [];

  for (let page = 1; page <= 50; page += 1) {
    const response = await fiveDollarGet(
      `/fixtures?start_time=${start}&end_time=${end}&include=odds&page=${page}&per_page=100`,
    );
    if (response.status !== "OK" || response.payload === null) {
      if (response.status === "RATE_LIMITED") {
        throw new BackendError("RATE_LIMITED", "A fonte de jogos atingiu o limite temporário. A automação tentará novamente.", 429);
      }
      throw new BackendError(
        "UPSTREAM_UNAVAILABLE",
        "Não foi possível consultar os jogos de D+2 agora. A automação tentará novamente.",
        503,
      );
    }

    fixtures.push(...parseFixtures(response.payload));
    if (!payloadHasMore(response.payload)) break;
  }

  return fixtures;
}

async function kickWorker(db: AdminDb) {
  const { error } = await callRuntimeRpc<number | null>(db, "kick_analysis_worker");
  if (error) {
    throw new BackendError("INTERNAL_ERROR", "A análise foi preparada, mas o worker não pôde ser acionado.", 500);
  }
}

async function ensureScheduledJob(db: AdminDb, ownerId: string, runId: string, jobStatus: string | null) {
  if (jobStatus === "DONE") return { status: "DONE", created: false };

  if (jobStatus === "ERROR") {
    const retry = await callRuntimeRpc<RetryRow[] | RetryRow>(db, "retry_analysis_job_atomic", {
      p_run_id: runId,
      p_user_id: ownerId,
    });
    const row = firstRow(retry.data);
    if (retry.error || row?.retried !== true) {
      throw new BackendError("INTERNAL_ERROR", "Não foi possível retomar a análise automática.", 500);
    }
    await kickWorker(db);
    return { status: row.status ?? "QUEUED", created: false };
  }

  if (jobStatus === "QUEUED" || jobStatus === "RUNNING") {
    await kickWorker(db);
    return { status: jobStatus, created: false };
  }

  const enqueue = await callRuntimeRpc<ScheduledEnqueueRow[] | ScheduledEnqueueRow>(
    db,
    "enqueue_scheduled_analysis_job_atomic",
    { p_run_id: runId, p_user_id: ownerId },
  );
  const row = firstRow(enqueue.data);
  if (enqueue.error || !row) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível colocar a análise automática na fila.", 500);
  }
  await kickWorker(db);
  return { status: row.status || "QUEUED", created: Boolean(row.created) };
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

async function createScheduledRun(
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
    throw new BackendError("INTERNAL_ERROR", "Não foi possível criar a análise automática de D+2.", 500);
  }
  return { runId: row.run_id, reused: Boolean(row.reused) };
}

export async function runScheduledDailyAnalysis(now = new Date()) {
  const db = await adminDb();
  const configResult = await callRuntimeRpc<ScheduledConfigRow[] | ScheduledConfigRow>(
    db,
    "get_scheduled_daily_analysis_config",
  );
  const config = firstRow(configResult.data);
  if (configResult.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar a configuração da análise automática.", 500);
  }
  if (!config || !config.enabled) {
    return { status: "DISABLED" as const, targetDate: null, runId: null, fixtures: 0 };
  }

  const targetDate = scheduledTargetDate(now, config.target_offset_days);
  const stateResult = await callRuntimeRpc<ScheduledStateRow[] | ScheduledStateRow>(
    db,
    "get_scheduled_daily_analysis_state",
    { p_owner_id: config.owner_id, p_target_date: targetDate },
  );
  if (stateResult.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível verificar a análise automática do dia.", 500);
  }
  const existing = firstRow(stateResult.data);
  if (existing?.run_id) {
    if (existing.run_status === "READY_FOR_ODDS" || existing.job_status === "DONE") {
      return {
        status: "READY" as const,
        targetDate,
        runId: existing.run_id,
        fixtures: null,
        reused: true,
      };
    }
    const job = await ensureScheduledJob(db, config.owner_id, existing.run_id, existing.job_status);
    return {
      status: "RESUMED" as const,
      targetDate,
      runId: existing.run_id,
      fixtures: null,
      reused: true,
      jobStatus: job.status,
    };
  }

  if (activeFootballProvider() !== "five_dollar" || !fiveDollarConfigured()) {
    throw new BackendError(
      "UPSTREAM_UNAVAILABLE",
      "A análise automática exige o provedor 5Dollar configurado no servidor.",
      503,
    );
  }

  const allowedIds = await allowedCompetitionIds(db);
  const providerFixtures = await fetchFixturesForLocalDate(targetDate);
  const fixtures = selectScheduledFixtures(providerFixtures, allowedIds);

  if (fixtures.length === 0) {
    return {
      status: "NO_ELIGIBLE_FIXTURES" as const,
      targetDate,
      runId: null,
      fixtures: 0,
      providerFixtures: providerFixtures.length,
    };
  }

  const created = await createScheduledRun(db, config.owner_id, targetDate, fixtures);
  const job = await ensureScheduledJob(db, config.owner_id, created.runId, null);
  return {
    status: created.reused ? ("RESUMED" as const) : ("QUEUED" as const),
    targetDate,
    runId: created.runId,
    fixtures: fixtures.length,
    providerFixtures: providerFixtures.length,
    reused: created.reused,
    jobStatus: job.status,
  };
}
