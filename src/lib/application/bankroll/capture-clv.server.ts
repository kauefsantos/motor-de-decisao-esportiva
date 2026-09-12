import type { Database } from "@/integrations/supabase/types";
import type { AdminDb } from "../../admin-db";

type TrackingTable = Database["public"]["Tables"]["experimental_bet_tracking"];
type TrackingRow = TrackingTable["Row"] & {
  clv_attempts: number;
  clv_next_retry_at: string | null;
};
type TrackingUpdate = TrackingTable["Update"] & {
  clv_attempts?: number;
  clv_next_retry_at?: string | null;
};

function retryAt(attempt: number) {
  if (attempt >= 3) return null;
  const minutes = attempt === 1 ? 15 : 30;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function trackingUpdate(values: TrackingUpdate): TrackingTable["Update"] {
  return values;
}

async function markUnavailable(
  db: AdminDb,
  trackingId: string,
  attempt: number,
  fetchedAt = new Date().toISOString(),
) {
  await db
    .from("experimental_bet_tracking")
    .update(
      trackingUpdate({
        clv_status: "SOURCE_UNAVAILABLE",
        clv_attempts: attempt,
        clv_next_retry_at: retryAt(attempt),
        closing_source: "five_dollar_bet365",
        closing_fetched_at: fetchedAt,
        updated_at: new Date().toISOString(),
      }),
    )
    .eq("id", trackingId);
  return { status: "SOURCE_UNAVAILABLE" as const, clvPct: null, impliedDelta: null };
}

export async function captureClosingClv(db: AdminDb, trackingId: string) {
  const { data: rawBet, error: betError } = await db
    .from("experimental_bet_tracking")
    .select("*")
    .eq("id", trackingId)
    .single();
  if (betError || !rawBet) return null;

  const bet = rawBet as TrackingRow;
  const attempt = Math.min(3, Number(bet.clv_attempts ?? 0) + 1);

  if (!bet.match_id) return markUnavailable(db, trackingId, attempt);

  const supported = new Set(["1x2", "goals_match_total", "corners_match_total", "cards_match_total"]);
  if (!supported.has(String(bet.market))) {
    await db
      .from("experimental_bet_tracking")
      .update(
        trackingUpdate({
          clv_status: "UNSUPPORTED",
          clv_attempts: 3,
          clv_next_retry_at: null,
          closing_source: "five_dollar_bet365",
          closing_fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      )
      .eq("id", trackingId);
    return { status: "UNSUPPORTED", clvPct: null, impliedDelta: null };
  }

  const { data: externalId } = await db
    .from("match_external_ids")
    .select("external_id")
    .eq("match_id", bet.match_id)
    .eq("source", "five_dollar_fixture")
    .maybeSingle();
  const fixtureId = Number(externalId?.external_id);
  if (!Number.isFinite(fixtureId)) return markUnavailable(db, trackingId, attempt);

  const [oddsModule, benchmarkModule, clvModule] = await Promise.all([
    import("../../bet365-odds.server"),
    import("../../bet365-benchmark.server"),
    import("../../engine/clv"),
  ]);
  const fetched = await oddsModule.fetchBet365FixtureOdds(fixtureId);
  await db.from("source_fetches").insert({
    run_id: bet.run_id,
    match_id: bet.match_id,
    source: "five_dollar_bet365_closing",
    status:
      fetched.status === "OK"
        ? "OK"
        : fetched.status === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : "SOURCE_UNAVAILABLE",
    http_status: fetched.httpStatus,
    error_message: fetched.errorMessage,
    fetched_at: fetched.fetchedAt,
  });

  if (fetched.status !== "OK" || fetched.payload === null) {
    return markUnavailable(db, trackingId, attempt, fetched.fetchedAt);
  }

  const candidate = {
    predictionId: String(bet.prediction_id),
    market: String(bet.market),
    side: bet.side === null ? null : String(bet.side),
    lineCanonical: bet.line_canonical === null ? null : Number(bet.line_canonical),
  };
  const opening = benchmarkModule.matchBet365OpeningPrice(candidate, fetched.payload);
  const closing = oddsModule.matchBet365ClosingPrice(candidate, fetched.payload);

  const statusMap = {
    MATCHED: null,
    LINE_MISMATCH: null,
    NO_PRICE: "NO_CLOSING_PRICE",
    UNSUPPORTED: "UNSUPPORTED",
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  } as const;
  const result =
    closing.status === "LINE_MISMATCH"
      ? clvModule.calculateClv({
          entryOdd: Number(bet.entry_odd),
          closingOdd: closing.odd,
          entryLine: candidate.lineCanonical,
          closingLine: closing.offeredLine,
        })
      : clvModule.calculateClv({
          entryOdd: Number(bet.entry_odd),
          closingOdd: closing.odd,
          entryLine: candidate.lineCanonical,
          closingLine: closing.offeredLine,
          sourceStatus: statusMap[closing.status],
        });

  const retryable = result.status === "SOURCE_UNAVAILABLE" || result.status === "NO_CLOSING_PRICE";
  await db
    .from("experimental_bet_tracking")
    .update(
      trackingUpdate({
        opening_odd: opening.status === "MATCHED" ? opening.odd : null,
        opening_line: opening.offeredLine,
        closing_odd: result.closingOdd,
        closing_line: result.closingLine,
        closing_stage: closing.stage,
        clv_pct: result.clvPct,
        clv_implied_delta: result.impliedDelta,
        clv_status: result.status,
        clv_attempts: attempt,
        clv_next_retry_at: retryable ? retryAt(attempt) : null,
        closing_fetched_at: fetched.fetchedAt,
        closing_source: "five_dollar_bet365",
        updated_at: new Date().toISOString(),
      }),
    )
    .eq("id", trackingId);

  return {
    ...result,
    openingOdd: opening.status === "MATCHED" ? opening.odd : null,
    openingLine: opening.offeredLine,
  };
}
