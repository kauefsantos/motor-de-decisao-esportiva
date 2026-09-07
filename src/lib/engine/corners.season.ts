// Recorte de temporada. Puro e testável. Não busca temporadas anteriores.
import type { CornerMatchRow } from "./corners";

/** temporada europeia: agosto a julho. "2025" = 2025/26. */
export function seasonOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 8 ? year : year - 1;
}

/** mantém somente as partidas da temporada mais recente presente nos dados. */
export function currentSeasonRows(rows: CornerMatchRow[]): CornerMatchRow[] {
  if (rows.length === 0) return [];
  const latest = Math.max(...rows.map((r) => seasonOf(r.date)));
  return rows.filter((r) => seasonOf(r.date) === latest);
}

export function seasonLabel(season: number): string {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}
