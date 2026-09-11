export type ClvStatus =
  | "MATCHED"
  | "LINE_MOVED"
  | "NO_CLOSING_PRICE"
  | "UNSUPPORTED"
  | "SOURCE_UNAVAILABLE";

export type ClvInput = {
  entryOdd: number;
  closingOdd: number | null;
  entryLine: number | null;
  closingLine: number | null;
  sourceStatus?: Exclude<ClvStatus, "MATCHED" | "LINE_MOVED"> | null;
};

export type ClvResult = {
  status: ClvStatus;
  closingOdd: number | null;
  closingLine: number | null;
  clvPct: number | null;
  impliedDelta: number | null;
};

/**
 * Closing-line value is only meaningful for the exact contract accepted.
 * For totals, a changed line makes the two prices non-comparable; we record the
 * move but deliberately do not manufacture a CLV number across different lines.
 */
export function calculateClv(input: ClvInput): ClvResult {
  if (input.sourceStatus) {
    return {
      status: input.sourceStatus,
      closingOdd: input.closingOdd,
      closingLine: input.closingLine,
      clvPct: null,
      impliedDelta: null,
    };
  }

  if (!Number.isFinite(input.entryOdd) || input.entryOdd <= 1) {
    return {
      status: "NO_CLOSING_PRICE",
      closingOdd: input.closingOdd,
      closingLine: input.closingLine,
      clvPct: null,
      impliedDelta: null,
    };
  }

  const lineBound = input.entryLine !== null;
  if (
    lineBound &&
    (input.closingLine === null || Math.abs(input.entryLine! - input.closingLine) > 1e-9)
  ) {
    return {
      status: "LINE_MOVED",
      closingOdd: input.closingOdd,
      closingLine: input.closingLine,
      clvPct: null,
      impliedDelta: null,
    };
  }

  const closingOdd = input.closingOdd;
  if (closingOdd === null || !Number.isFinite(closingOdd) || closingOdd <= 1) {
    return {
      status: "NO_CLOSING_PRICE",
      closingOdd: closingOdd ?? null,
      closingLine: input.closingLine,
      clvPct: null,
      impliedDelta: null,
    };
  }

  return {
    status: "MATCHED",
    closingOdd,
    closingLine: input.closingLine,
    clvPct: input.entryOdd / closingOdd - 1,
    impliedDelta: 1 / closingOdd - 1 / input.entryOdd,
  };
}
