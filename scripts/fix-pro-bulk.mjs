import fs from 'node:fs';

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch target: ${label}`);
  return text.replace(from, to);
}

const path = 'src/lib/pipeline.server.ts';
let s = fs.readFileSync(path, 'utf8');

s = replaceRequired(s,
`      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();\n      for (const m of matches ?? []) {`,
`      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();\n      const leagueTeamIds = new Map<string, Set<number>>();\n      for (const m of matches ?? []) {\n        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");\n        if (!leagueExternal?.external_id) continue;\n        const key = String(leagueExternal.external_id);\n        const set = leagueTeamIds.get(key) ?? new Set<number>();\n        for (const e of (externalIds ?? []).filter((x) => x.match_id === m.id && (x.source === "five_dollar_team_home" || x.source === "five_dollar_team_away"))) {\n          const id = Number(e.external_id);\n          if (Number.isFinite(id)) set.add(id);\n        }\n        leagueTeamIds.set(key, set);\n      }\n\n      for (const m of matches ?? []) {`,
'precompute all team ids by league');

s = replaceRequired(s,
`              history = await fiveDollarLeagueHistory(\n                Number(leagueExternal.external_id),\n                teams.map((t) => Number(t.external_id)),\n                predictionAt,\n                365,\n              );`,
`              history = await fiveDollarLeagueHistory(\n                Number(leagueExternal.external_id),\n                [...(leagueTeamIds.get(String(leagueExternal.external_id)) ?? new Set<number>())],\n                predictionAt,\n                365,\n              );`,
'bulk league uses all run teams');

s = replaceRequired(s,
`          if (history.observations.length > 0) {\n            observationsCount += history.observations.length;\n            await db.from("raw_observations").insert(history.observations.map((o) => ({`,
`          const teamObservations = history.observations.filter((o) => o.teamId === Number(team.external_id));\n          if (teamObservations.length > 0) {\n            observationsCount += teamObservations.length;\n            await db.from("raw_observations").insert(teamObservations.map((o) => ({`,
'filter bulk observations to current team');

s = replaceRequired(s,
`      await log(db, runId, "COLLECT", \`${'${observationsCount}'} observações 5Dollar; ${'${reusedFromCache}'} de cache; ${'${insufficient}'} times com histórico insuficiente${'${rateLimited ? "; coleta parcial por rate limit" : ""}'}.\`, observationsCount ? "INFO" : "WARN", {\n        provider, predictionAt, requestsMade: usage.requestsMade, rateLimit: usage.rateLimit, rateLimitHits: usage.rateLimitHits,\n      });`,
`      await log(db, runId, "COLLECT", \`${'${observationsCount}'} observações 5Dollar; ${'${reusedFromCache}'} de cache; ${'${insufficient}'} times com histórico insuficiente${'${rateLimited ? "; coleta parcial por rate limit" : ""}'}.\`, observationsCount ? "INFO" : "WARN", {\n        provider, predictionAt, requestsMade: usage.requestsMade, rateLimit: usage.rateLimit, rateLimitHits: usage.rateLimitHits,\n        bulkLeagues: leagueHistoryCache.size,\n        uniqueHistoricalFixtures: [...leagueHistoryCache.values()].reduce((sum, h) => sum + h.fixtures.length, 0),\n      });`,
'bulk diagnostics');

fs.writeFileSync(path, s);
try { fs.rmSync('scripts/fix-pro-bulk.mjs'); } catch {}
try { fs.rmSync('.github/workflows/fix-pro-bulk.yml'); } catch {}
