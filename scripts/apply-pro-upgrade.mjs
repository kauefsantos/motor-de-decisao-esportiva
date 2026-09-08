import fs from 'node:fs';

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch target: ${label}`);
  return text.replace(from, to);
}

// 1) Experimental runner: use rolling 365-day window for corners/goals and recency model reference date.
{
  const path = 'src/lib/experimental-markets-run.functions.ts';
  let s = fs.readFileSync(path, 'utf8');
  s = replaceRequired(s,
`      const targetSeason = seasonKey(predictionDate, league);\n\n      const cornerTraining = datasets.corners.filter(\n        (r) =>\n          r.league === league &&\n          r.date < predictionDate &&\n          seasonKey(r.date, league) === targetSeason,\n      );`,
`      const rollingStartDate = new Date(Date.parse(predictionDate + "T00:00:00Z") - 365 * 86400_000)\n        .toISOString().slice(0, 10);\n\n      const cornerTraining = datasets.corners.filter(\n        (r) => r.league === league && r.date < predictionDate && r.date >= rollingStartDate,\n      );`, 'corners rolling window');
  s = replaceRequired(s,
`      const goalTraining = datasets.goals.filter(\n        (r) =>\n          r.league === league &&\n          r.date < predictionDate &&\n          seasonKey(r.date, league) === targetSeason,\n      );`,
`      const goalTraining = datasets.goals.filter(\n        (r) => r.league === league && r.date < predictionDate && r.date >= rollingStartDate,\n      );`, 'goals rolling window');
  s = replaceRequired(s,
`          \`${'${label}'}: gols com \${goalTraining.length} partida(s) da temporada atual; mínimo experimental \${MIN_EXPERIMENTAL_MATCHES}.\`,`,
`          \`${'${label}'}: gols com \${goalTraining.length} partida(s) nos últimos 365 dias; mínimo experimental \${MIN_EXPERIMENTAL_MATCHES}.\`,`, 'goal diagnostic');
  s = replaceRequired(s,
`      const goalParams = fitGoalsBaseline(goalTraining);`,
`      const goalParams = fitGoalsBaseline(goalTraining, predictionDate);`, 'goals recency reference');
  s = replaceRequired(s,
`        issues.push(\`${'${label}'}: times ainda sem amostra própria suficiente de gols na temporada atual.\`);`,
`        issues.push(\`${'${label}'}: pelo menos um time não possui partida própria de gols nos últimos 365 dias.\`);`, 'goal sample diagnostic');
  fs.writeFileSync(path, s);
}

// 2) Pipeline: persist league ID and prefer one bulk historical request per league/run.
{
  const path = 'src/lib/pipeline.server.ts';
  let s = fs.readFileSync(path, 'utf8');
  s = replaceRequired(s,
`  confidence: number,\n) {\n  await db.from("match_external_ids").delete().eq("match_id", matchId).in("source", [fixtureSource, homeSource, awaySource]);`,
`  confidence: number,\n  leagueSource?: string,\n  leagueId?: number | null,\n) {\n  const sources = [fixtureSource, homeSource, awaySource, ...(leagueSource ? [leagueSource] : [])];\n  await db.from("match_external_ids").delete().eq("match_id", matchId).in("source", sources);`, 'replaceExternalIds signature');
  s = replaceRequired(s,
`    ...(awayTeamId ? [{ match_id: matchId, source: awaySource, external_id: String(awayTeamId), confidence }] : []),\n  ]);`,
`    ...(awayTeamId ? [{ match_id: matchId, source: awaySource, external_id: String(awayTeamId), confidence }] : []),\n    ...(leagueSource && leagueId ? [{ match_id: matchId, source: leagueSource, external_id: String(leagueId), confidence }] : []),\n  ]);`, 'league external id insert');
  s = replaceRequired(s,
`          await replaceExternalIds(db, m.id, "five_dollar_fixture", "five_dollar_team_home", "five_dollar_team_away", fd.resolution.eventId!, event?.homeTeamId ?? null, event?.awayTeamId ?? null, fd.resolution.confidence);`,
`          await replaceExternalIds(db, m.id, "five_dollar_fixture", "five_dollar_team_home", "five_dollar_team_away", fd.resolution.eventId!, event?.homeTeamId ?? null, event?.awayTeamId ?? null, fd.resolution.confidence, "five_dollar_league", event?.leagueId ?? null);`, 'persist five dollar league');
  s = replaceRequired(s,
`          endpoint: fd.fetch.path,\n          httpStatus: fd.fetch.httpStatus,`,
`          endpoint: fd.fetch.path,\n          pages: fd.fetches?.length ?? 1,\n          httpStatus: fd.fetch.httpStatus,`, 'resolver page log');
  s = replaceRequired(s,
`    const { fiveDollarTeamHistory, fiveDollarConfigured, fiveDollarUsage, FIVE_DOLLAR_SOURCE, FIVE_DOLLAR_DEFINITION_VERSION } = await import("./adapters/five_dollar.server");`,
`    const { fiveDollarTeamHistory, fiveDollarLeagueHistory, fiveDollarConfigured, fiveDollarUsage, FIVE_DOLLAR_SOURCE, FIVE_DOLLAR_DEFINITION_VERSION } = await import("./adapters/five_dollar.server");`, 'bulk history import');

  const loopStart = `      for (const m of matches ?? []) {\n        if (rateLimited) break;\n        const teams = (externalIds ?? []).filter((e) => e.match_id === m.id && (e.source === "five_dollar_team_home" || e.source === "five_dollar_team_away"));`;
  const loopReplacement = `      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();\n      for (const m of matches ?? []) {\n        if (rateLimited) break;\n        const teams = (externalIds ?? []).filter((e) => e.match_id === m.id && (e.source === "five_dollar_team_home" || e.source === "five_dollar_team_away"));\n        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");`;
  s = replaceRequired(s, loopStart, loopReplacement, 'league history cache setup');

  const historyCall = `          const history = await fiveDollarTeamHistory(Number(team.external_id), predictionAt);`;
  const historyReplacement = `          let history;\n          if (leagueExternal?.external_id) {\n            const key = \`${'${leagueExternal.external_id}'}:${'${predictionAt}'}\`;\n            history = leagueHistoryCache.get(key);\n            if (!history) {\n              history = await fiveDollarLeagueHistory(\n                Number(leagueExternal.external_id),\n                teams.map((t) => Number(t.external_id)),\n                predictionAt,\n                365,\n              );\n              leagueHistoryCache.set(key, history);\n            }\n          } else {\n            history = await fiveDollarTeamHistory(Number(team.external_id), predictionAt, 20);\n          }`;
  s = replaceRequired(s, historyCall, historyReplacement, 'bulk league history call');
  fs.writeFileSync(path, s);
}

// 3) Tests for recency weighting and cutoff semantics.
{
  const path = 'src/lib/engine/goals.recency.test.ts';
  fs.writeFileSync(path, `import { describe, expect, it } from "vitest";\nimport { fitGoalsBaseline, recencyWeight, predictGoals, type GoalMatchRow } from "./goals";\n\ndescribe("goals-baseline-v2-recency", () => {\n  it("gives recent matches more weight", () => {\n    expect(recencyWeight(0)).toBeCloseTo(1, 8);\n    expect(recencyWeight(120)).toBeCloseTo(0.5, 8);\n    expect(recencyWeight(240)).toBeCloseTo(0.25, 8);\n  });\n\n  it("keeps sampleSize as real match count", () => {\n    const rows: GoalMatchRow[] = [\n      { date: "2026-01-01", league: "L", homeTeam: "A", awayTeam: "B", homeGoals: 1, awayGoals: 0 },\n      { date: "2026-07-01", league: "L", homeTeam: "B", awayTeam: "A", homeGoals: 0, awayGoals: 2 },\n      { date: "2026-08-01", league: "L", homeTeam: "A", awayTeam: "B", homeGoals: 3, awayGoals: 1 },\n    ];\n    const p = fitGoalsBaseline(rows, "2026-09-01");\n    const out = predictGoals(p, { league: "L", homeTeam: "A", awayTeam: "B" });\n    expect(out.sampleSize).toBe(3);\n    expect(out.lambdaTotal).toBeGreaterThan(0);\n  });\n});\n`);
}

// remove one-shot patcher/workflow in the commit produced by the workflow
try { fs.rmSync('scripts/apply-pro-upgrade.mjs'); } catch {}
try { fs.rmSync('.github/workflows/apply-pro-upgrade.yml'); } catch {}
