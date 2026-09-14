import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import {
  STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  STAGE8_RETROSPECTIVE_START,
  runStage8OneXTwoErrorAudit,
} from "./stage8-1x2-error-audit";
import { runStage8Home20Challenger } from "./stage8-home20-challenger";

export async function runStage8OneXTwoErrorAuditValidation() {
  const rows = await loadStage6GoalsValidationRows();
  const audit = runStage8OneXTwoErrorAudit(rows);
  const home20 = runStage8Home20Challenger(
    rows,
    STAGE8_RETROSPECTIVE_START,
    STAGE8_RETROSPECTIVE_END_EXCLUSIVE,
  );
  return {
    ...audit,
    challengers: {
      home20,
    },
  };
}
