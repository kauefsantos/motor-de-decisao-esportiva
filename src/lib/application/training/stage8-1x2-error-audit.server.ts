import { loadStage6GoalsValidationRows } from "./goals-validation.server";
import { runStage8OneXTwoErrorAudit } from "./stage8-1x2-error-audit";

export async function runStage8OneXTwoErrorAuditValidation() {
  const rows = await loadStage6GoalsValidationRows();
  return runStage8OneXTwoErrorAudit(rows);
}
