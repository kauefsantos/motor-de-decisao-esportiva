function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isCrossLeagueCompetitionName(value: string | null | undefined): boolean {
  const n = normalized(value ?? "");
  if (!n) return false;
  return /(?:^|-)uefa-(?:champions|europa|conference)-league(?:-|$)/.test(n)
    || /(?:^|-)champions-league(?:-|$)/.test(n)
    || /(?:^|-)libertadores(?:-|$)/.test(n)
    || /(?:^|-)sudamericana(?:-|$)/.test(n)
    || /(?:^|-)club-world-cup(?:-|$)/.test(n)
    || /(?:^|-)copa-libertadores(?:-|$)/.test(n)
    || /(?:^|-)copa-sudamericana(?:-|$)/.test(n);
}

export function isCrossLeagueLeagueKey(value: string | null | undefined): boolean {
  return isCrossLeagueCompetitionName(value);
}

export function isLikelyDomesticLeagueKey(value: string | null | undefined): boolean {
  const n = normalized(value ?? "");
  if (!n || isCrossLeagueLeagueKey(n)) return false;
  if (/(?:^|-)(cup|copa|pokal|coppa|coupe|taca)(?:-|$)/.test(n)) return false;
  if (/(?:^|-)(qualifier|qualifiers|qualification)(?:-|$)/.test(n)) return false;
  if (/(?:^|-)(friendly|friendlies)(?:-|$)/.test(n)) return false;
  if (["camp-brasil", "serie", "uefa-cl"].includes(n)) return false;
  return true;
}
