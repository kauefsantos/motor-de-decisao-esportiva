import type { AdminDb } from "../../admin-db";

export async function captureClosingClv(db: AdminDb, trackingId: string) {
  const { data: bet, error: betError } = await db
    .from("experimental_bet_tracking")
    .select("id,run_id,match_id,prediction_id,market,side,line_canonical,entry_odd")
    .eq("id", trackingId)
    .single();
  if (betError || !bet) return null;
  if (!bet.match_id) {
    await db.from("experimental_bet_tracking").update({
      clv_status: "SOURCE_UNAVAILABLE",
      closing_source: "five_dollar_bet365",
      closing_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", trackingId);
    return { status: "SOURCE_UNAVAILABLE", clvPct: null, impliedDelta: null };
  }

  const supported = new Set(["1x2", "goals_match_total", "corners_match_total", "cards_match_total"]);
  if (!supported.has(String(bet.market))) {
    await db.from("experimental_bet_tracking").update({
      clv_status: "UNSUPPORTED",
      closing_source: "five_dollar_bet365",
      closing_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", trackingId);
    return { status: "UNSUPPORTED", clvPct: null, impliedDelta: null };
  }

  const { data: externalId } = await db
    .from("match_external_ids")
    .select("external_id")
    .eq("match_id", bet.match_id)
    .eq("source", "five_dollar_fixture")
    .maybeSingle();
  const fixtureId = Number(externalId?.external_id);
  if (!Number.isFinite(fixtureId)) {
    await db.from("experimental_bet_tracking").update({
      clv_status: "SOURCE_UNAVAILABLE",
      closing_source: "five_dollar_bet365",
      closing_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", trackingId);
    return { status: "SOURCE_UNAVAILABLE", clvPct: null, impliedDelta: null };
  }

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
    status: fetched.status === "OK" ? "OK" : fetched.status === "RATE_LIMITED" ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE",
    http_status: fetched.httpStatus,
    error_message: fetched.errorMessage,
    fetched_at: fetched.fetchedAt,
  });

  if (fetched.status !== "OK" || fetched.payload === null) {
    await db.from("experimental_bet_tracking").update({
      clv_status: "SOURCE_UNAVAILABLE",
      closing_source: "five_dollar_bet365",
      closing_fetched_at: fetched.fetchedAt,
      updated_at: new Date().toISOString(),
    }).eq("id", trackingId);
    return { status: "SOURCE_UNAVAILABLE", clvPct: null, impliedDelta: null };
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
  const result = closing.status === "LINE_MISMATCH"
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

  await db.from("experimental_bet_tracking").update({
    opening_odd: opening.status === "MATCHED" ? opening.odd : null,
    opening_line: opening.offeredLine,
    closing_odd: result.closingOdd,
    closing_line: result.closingLine,
    closing_stage: closing.stage,
    clv_pct: result.clvPct,
    clv_implied_delta: result.impliedDelta,
    clv_status: result.status,
    closing_fetched_at: fetched.fetchedAt,
    closing_source: "five_dollar_bet365",
    updated_at: new Date().toISOString(),
  }).eq("id", trackingId);

  return {
    ...result,
    openingOdd: opening.status === "MATCHED" ? opening.odd : null,
    openingLine: opening.offeredLine,
  };
}
