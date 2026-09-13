import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb } from "./admin-db";
import { assertRunOwner } from "./authorization.server";
import { filterQuoteAnchorPredictions } from "./engine/market-policy";
import { selectExperimentalPortfolio } from "./engine/portfolio-selection";
import { MAX_SELECTIONS } from "./engine/value";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  PRODUCTION_STATUS,
} from "./application/experimental-markets/contracts";
import { prepareExperimentalPredictionsForRun } from "./application/experimental-markets/prepare-run.server";
import {
  buildDirectionAssessments,
  buildTrackingRows,
  evaluateExperimentalEntries,
} from "./application/experimental-markets/value-tracking";
import {
  loadExperimentalMatchesByIds,
  loadExperimentalOddsState,
  upsertExperimentalTracking,
} from "./repositories/experimental-markets.repository.server";

export { EXPERIMENTAL_MARKETS_STATUS } from "./application/experimental-markets/contracts";

const prepareSchema = z.object({ runId: z.string().uuid() });

export const prepareExperimentalMarketsRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => prepareSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await assertRunOwner(db, context.userId, data.runId);
    return prepareExperimentalPredictionsForRun(db, data.runId);
  });

const oddsSchema = z.object({
  runId: z.string().uuid(),
  entries: z.array(z.object({
    predictionId: z.string().min(1).max(180),
    odd: z.number().finite().gt(1).lt(1000),
    lineAtEntry: z.number().finite().nullable(),
  })).min(1).max(1000),
});

export const analyzeExperimentalMarketsOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await assertRunOwner(db, context.userId, data.runId);

    const { predictions, targetDate } = await loadExperimentalOddsState(db, data.runId);
    const quotePredictions = filterQuoteAnchorPredictions(predictions);
    const results = evaluateExperimentalEntries(quotePredictions, data.entries);
    const selectionLimit = MAX_SELECTIONS;
    const portfolio = selectExperimentalPortfolio(results);
    const selected = portfolio.selected;

    if (selected.length > 0) {
      const selectedMatchIds = selected
        .map((row) => row.matchId)
        .filter((id): id is string => Boolean(id));
      const matches = await loadExperimentalMatchesByIds(db, selectedMatchIds);
      await upsertExperimentalTracking(
        db,
        buildTrackingRows(data.runId, targetDate, selected, matches),
      );
    }

    const selectedIds = new Set(selected.map((row) => row.predictionId));
    const directionAssessments = buildDirectionAssessments(quotePredictions, results);
    return {
      evaluations: results.map((row) => ({
        ...row,
        selected: selectedIds.has(row.predictionId),
      })),
      selections: selected,
      correlatedAlternates: portfolio.correlatedAlternates,
      directionAssessments,
      referenceAlternatives: directionAssessments.flatMap(
        (assessment) => assessment.referenceAlternatives,
      ),
      selectionLimit,
      targetDate,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
    };
  });
