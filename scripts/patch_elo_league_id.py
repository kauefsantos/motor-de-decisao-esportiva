from pathlib import Path

p = Path('src/lib/experimental-markets-run.functions.ts')
s = p.read_text()
needle = '''      const awayId = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_team_away",
      )?.external_id;
      const league = mostFrequentLeague(
'''
replacement = '''      const awayId = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_team_away",
      )?.external_id;
      const leagueIdRaw = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_league",
      )?.external_id;
      const leagueId = leagueIdRaw && Number.isFinite(Number(leagueIdRaw)) ? Number(leagueIdRaw) : null;
      const league = mostFrequentLeague(
'''
if needle not in s:
    raise SystemExit('league id insertion marker not found')
s = s.replace(needle, replacement, 1)
needle2 = '''          leagueKey: league,
          homeTeamId: Number(homeId),
'''
replacement2 = '''          leagueKey: league,
          leagueId,
          homeTeamId: Number(homeId),
'''
if needle2 not in s:
    raise SystemExit('elo call marker not found')
s = s.replace(needle2, replacement2, 1)
p.write_text(s)

# Keep Node/server Elo discovery aligned with the DB cron coverage.
p = Path('src/lib/elo-sync.server.ts')
s = p.read_text()
s = s.replace(
    '  if (country === "EC") return n === "ecuador ligapro serie a" || n === "ecuador ligapro serie b";\n  return false;',
    '  if (country === "EC") return n === "ecuador ligapro serie a" || n === "ecuador ligapro serie b";\n'
    '  if (country === "BE") return n === "belgium pro league";\n'
    '  if (country === "US") return n === "usa major league soccer" || n === "major league soccer" || n === "mls";\n'
    '  if (country === "SA") return n === "saudi arabia pro league" || n === "saudi pro league";\n'
    '  return false;',
    1,
)
s = s.replace(
    '  const countries = ["GB-ENG", "DE", "ES", "IT", "FR", "BR", "NL", "PT", "TR", "SK", "NO", "AR", "EC"];',
    '  const countries = ["GB-ENG", "DE", "ES", "IT", "FR", "BR", "NL", "PT", "BE", "TR", "SK", "NO", "AR", "EC", "US", "SA"];',
    1,
)
p.write_text(s)
