import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import {
  STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  STAGE8_RETROSPECTIVE_START,
  runStage8OneXTwoErrorAudit,
} from "./stage8-1x2-error-audit";
import { runStage8Home20Challenger } from "./stage8-home20-challenger";
import { runStage8Home40Challenger } from "./stage8-home40-challenger";
import { runStage8PureEloChallengers } from "./stage8-elo-pure-challenger";

export async function runStage8OneXTwoErrorAuditValidation() {
  const rows = await loadStage6GoalsValidationRows();
  const audit = runStage8OneXTwoErrorAudit(rows);
  const home20 = runStage8Home20Challenger(
    rows,
    STAGE8_RETROSPECTIVE_START,
    STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  );
  const home40 = runStage8Home40Challenger(
    rows,
    STAGE8_RETROSPECTIVE_START,
    STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  );
  const pureElo = runStage8PureEloChallengers(
    rows,
    STAGE8_RETROSPECTIVE_START,
    STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  );
  return {
    ...audit,
    challengers: {
      home20,
      home40,
      eloPure60: pureElo.eloPure60,
      eloPure0: pureElo.eloPure0,
    },
  };
}
