import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { backendOk, BackendError } from "./backend-contract";
import { saoPauloLocalDateTimeToIso } from "./sao-paulo-time";

const rowSchema = z.object({
  partida: z.string().trim().min(1).max(160),
  horario: z.string().trim().min(1).max(32),
  campeonato: z.string().trim().min(1).max(120),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const draftSchema = z.object({
  clientRequestId: z.string().uuid(),
  filename: z.string().trim().min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  headers: z.array(z.string().max(80)).max(30),
  invalidCount: z.number().int().min(0),
  leagues: z.array(z.string().max(120)).max(200),
  rows: z.array(rowSchema).min(1).max(300),
});

const draftIdSchema = z.object({ draftId: z.string().uuid() });
const correctionSchema = z.object({
  draftId: z.string().uuid(),
  corrections: z.array(z.object({
    gameId: z.string().uuid(),
    field: z.enum(["partida", "horario", "campeonato", "target_date"]),
    value: z.string().trim().min(1).max(200),
  })).min(1).max(300),
});

const FINALIZE_SCHEMA = z.object({
  draftId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

const SEPARATOR = /\s+(?:x|vs?|-)+\s+/i;

function parseTeams(partida: string) {
  const parts = partida.split(SEPARATOR);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0]!.trim(), away: parts[1]!.trim() };
}

function kickoff(targetDate: string, horario: string) {
  const match = horario.match(/^\s*(\d{1,2})[:h](\d{2})\s*$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  try {
    return saoPauloLocalDateTimeToIso(
      targetDate,
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  } catch {
    return null;
  }
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function requireDraft(db: any, draftId: string, ownerId: string) {
  const { data, error } = await db.from("analysis_drafts").select("*").eq("id", draftId).eq("owner_id", ownerId).single();
  if (error || !data) throw new BackendError("NOT_FOUND", "Rascunho não encontrado.", 404);
  return data;
}

export const createAnalysisDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const { data: rows, error } = await db.rpc("create_analysis_draft_atomic", {
      p_owner_id: context.userId,
      p_client_request_id: data.clientRequestId,
      p_filename: data.filename,
      p_target_date: data.targetDate,
      p_headers: data.headers,
      p_leagues: data.leagues,
      p_invalid_count: data.invalidCount,
      p_rows: data.rows,
    });
    if (error) throw new BackendError("VALIDATION_ERROR", "Não foi possível criar o rascunho da análise.", 400);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.draft_id) throw new BackendError("INTERNAL_ERROR", "O rascunho não retornou um identificador.", 500);
    return backendOk({ draftId: String(row.draft_id), reused: Boolean(row.reused) });
  });

export const getAnalysisDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => draftIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    const draft = await requireDraft(db, data.draftId, context.userId);
    const { data: games, error } = await db.from("analysis_draft_games").select("*").eq("draft_id", data.draftId).order("ordinal");
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as partidas para validação.", 500);
    return backendOk({ draft, games: games ?? [] });
  });

export const validateAnalysisDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => draftIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await requireDraft(db, data.draftId, context.userId);
    const { data: games, error } = await db.from("analysis_draft_games").select("*").eq("draft_id", data.draftId).order("ordinal");
    if (error) throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as partidas para validação.", 500);

    const { fiveDollarResolveMatch, fiveDollarConfigured } = await import("./adapters/five_dollar.server");
    if (!fiveDollarConfigured()) throw new BackendError("UPSTREAM_UNAVAILABLE", "A fonte esportiva principal não está configurada.", 503);

    let valid = 0;
    let invalid = 0;
    const output: any[] = [];

    for (const game of games ?? []) {
      const editable = new Set<string>();
      const errors: Array<{ field: string; code: string; message: string }> = [];
      let suggestions: Array<Record<string, unknown>> = [];
      const date = game.target_date ? String(game.target_date).slice(0, 10) : "";
      const teams = parseTeams(String(game.partida ?? ""));
      const parsedKickoff = date ? kickoff(date, String(game.horario ?? "")) : null;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        editable.add("target_date");
        errors.push({ field: "target_date", code: "INVALID_DATE", message: "A data não é válida." });
      }
      if (!teams.home || !teams.away) {
        editable.add("partida");
        errors.push({ field: "partida", code: "INVALID_MATCH_NAME", message: "Use o formato Mandante x Visitante." });
      }
      if (!parsedKickoff) {
        editable.add("horario");
        errors.push({ field: "horario", code: "INVALID_TIME", message: "O horário precisa estar entre 00:00 e 23:59." });
      }

      let resolution: any = null;
      let event: any = null;
      if (editable.size === 0) {
        const resolved = await fiveDollarResolveMatch({
          homeTeam: teams.home,
          awayTeam: teams.away,
          competition: String(game.campeonato ?? ""),
          kickoff: parsedKickoff,
        }, date);
        resolution = resolved.resolution;
        if (resolution?.status === "MATCH_RESOLVED") {
          event = resolved.events.find((item: any) => item.eventId === resolution.eventId) ?? null;
        } else if (resolution?.status === "MATCH_AMBIGUOUS") {
          const best = resolution.candidates?.[0];
          if ((best?.homeSimilarity ?? 0) < 0.78 || (best?.awaySimilarity ?? 0) < 0.78) editable.add("partida");
          if ((best?.kickoffScore ?? 0) < 0.5) editable.add("horario");
          if ((best?.competitionSimilarity ?? 0) < 0.55) editable.add("campeonato");
          if (editable.size === 0) editable.add("partida");
          errors.push({ field: [...editable][0] ?? "partida", code: "AMBIGUOUS_MATCH", message: "Há mais de uma correspondência possível para esta partida." });
          suggestions = (resolution.candidates ?? []).slice(0, 5).map((candidate: any) => ({
            eventId: candidate.eventId,
            partida: candidate.label,
            confidence: candidate.score,
          }));
        } else {
          let dateSuggestion: { date: string; label: string; eventId: number; confidence: number } | null = null;
          for (const offset of [-1, 1]) {
            const adjacent = addDays(date, offset);
            const candidate = await fiveDollarResolveMatch({
              homeTeam: teams.home,
              awayTeam: teams.away,
              competition: String(game.campeonato ?? ""),
              kickoff: kickoff(adjacent, String(game.horario ?? "")),
            }, adjacent);
            if (candidate.resolution?.status === "MATCH_RESOLVED") {
              const found = candidate.events.find((item: any) => item.eventId === candidate.resolution?.eventId);
              dateSuggestion = {
                date: adjacent,
                label: found ? `${found.homeName} x ${found.awayName}` : candidate.resolution.candidates?.[0]?.label ?? String(game.partida),
                eventId: Number(candidate.resolution.eventId),
                confidence: Number(candidate.resolution.confidence),
              };
              break;
            }
          }
          if (dateSuggestion) {
            editable.add("target_date");
            suggestions = [dateSuggestion];
            errors.push({ field: "target_date", code: "LIKELY_WRONG_DATE", message: `A partida foi encontrada em ${dateSuggestion.date}.` });
          } else {
            editable.add("partida");
            errors.push({ field: "partida", code: "MATCH_NOT_FOUND", message: "A partida não foi localizada nessa data. Confira os nomes dos times." });
            suggestions = (resolution?.candidates ?? []).slice(0, 5).map((candidate: any) => ({ eventId: candidate.eventId, partida: candidate.label, confidence: candidate.score }));
          }
        }
      }

      const status = event && editable.size === 0 ? "VALID" : resolution?.status === "MATCH_AMBIGUOUS" ? "AMBIGUOUS" : "INVALID";
      if (status === "VALID") valid += 1; else invalid += 1;
      const patch = {
        validation_status: status,
        editable_fields: [...editable],
        validation_errors: errors,
        suggestions,
        resolved_event_id: event?.eventId ?? null,
        resolved_home_team: event?.homeName ?? null,
        resolved_away_team: event?.awayName ?? null,
        resolved_competition: event?.tournament ?? null,
        resolved_kickoff: event?.kickoffIso ?? (event?.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null),
        resolver_confidence: resolution?.confidence ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await db.from("analysis_draft_games").update(patch).eq("id", game.id).eq("draft_id", data.draftId);
      if (updateError) throw new BackendError("INTERNAL_ERROR", "Não foi possível salvar o resultado da validação.", 500);
      output.push({ id: game.id, ordinal: game.ordinal, ...patch });
    }

    const draftStatus = invalid === 0 ? "READY" : "NEEDS_CORRECTION";
    await db.from("analysis_drafts").update({ status: draftStatus, updated_at: new Date().toISOString() }).eq("id", data.draftId).eq("owner_id", context.userId);
    return backendOk({ draftId: data.draftId, status: draftStatus, valid, invalid, games: output });
  });

export const correctAnalysisDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => correctionSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await requireDraft(db, data.draftId, context.userId);
    const { data: changed, error } = await db.rpc("apply_analysis_draft_corrections", {
      p_draft_id: data.draftId,
      p_owner_id: context.userId,
      p_corrections: data.corrections,
    });
    if (error) throw new BackendError("CONFLICT", "Uma correção tentou alterar um campo que não estava marcado como inválido.", 409);
    return backendOk({ changed: Number(changed ?? 0), needsValidation: true });
  });

export const finalizeAnalysisDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => FINALIZE_SCHEMA.parse(input))
  .handler(async ({ data, context }) => {
    if (!context.userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
    const db = await adminDb();
    await requireDraft(db, data.draftId, context.userId);
    const { data: finalized, error } = await db.rpc("finalize_analysis_draft_atomic", {
      p_draft_id: data.draftId,
      p_owner_id: context.userId,
      p_idempotency_key: data.idempotencyKey,
    });
    if (error) throw new BackendError("CONFLICT", "Ainda existem partidas que precisam ser corrigidas antes do processamento.", 409);
    const row = Array.isArray(finalized) ? finalized[0] : finalized;
    if (!row?.run_id) throw new BackendError("INTERNAL_ERROR", "A análise validada não pôde ser criada.", 500);

    const { data: queued, error: queueError } = await db.rpc("enqueue_analysis_job_atomic", {
      p_run_id: row.run_id,
      p_user_id: context.userId,
    });
    if (queueError) throw new BackendError("INTERNAL_ERROR", "A análise foi criada, mas não pôde ser colocada na fila.", 500);
    const queue = Array.isArray(queued) ? queued[0] : queued;
    if (queue?.status !== "ERROR" && queue?.status !== "DONE") {
      const { error: kickError } = await db.rpc("kick_analysis_worker");
      if (kickError) throw new BackendError("INTERNAL_ERROR", "A análise foi criada, mas o processamento não pôde ser iniciado.", 500);
    }
    return backendOk({ runId: String(row.run_id), reused: Boolean(row.reused), jobStatus: queue?.status ?? "QUEUED" });
  });
