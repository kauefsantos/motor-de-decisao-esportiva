import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { adminDb } from "./admin-db";
import { assertRunOwner } from "./authorization.server";
import { collectAutomaticBet365OddsForRun } from "./auto-bet365-odds.service.server";

const inputSchema = z.object({ runId: z.string().uuid() });

export const collectAutomaticBet365Odds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = await adminDb();
    await assertRunOwner(db, context.userId, data.runId);
    return collectAutomaticBet365OddsForRun(db, data.runId);
  });
