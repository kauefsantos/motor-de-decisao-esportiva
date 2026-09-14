import { createServerFn } from "@tanstack/react-start";

import { adminDb } from "./admin-db";
import { BackendError } from "./backend-contract";
import { callRuntimeRpc } from "./repositories/runtime-rpc.server";

export type ModelLabJson =
  | string
  | number
  | boolean
  | null
  | ModelLabJson[]
  | { [key: string]: ModelLabJson };

export type ModelLabEvent = {
  id: string;
  stage: string;
  event_type: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  message: string;
  model_version: string | null;
  candidate_version: string | null;
  payload: { [key: string]: ModelLabJson } | null;
  created_at: string;
  read_at: string | null;
};

export const getModelLabNotifications = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para acompanhar o laboratório.", 401);

  const db = await adminDb();
  const result = await callRuntimeRpc<ModelLabEvent[]>(db, "get_model_lab_events", {
    p_owner_id: userId,
    p_limit: 8,
  });
  if (result.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível carregar as novidades da Stage 9.", 500);
  }

  const events = result.data ?? [];
  return {
    events,
    unreadCount: events.filter((event) => !event.read_at).length,
    experimentalMode: "ACTIVE" as const,
    labMode: "STAGE9_BACKGROUND" as const,
  };
});

export const markModelLabNotificationsRead = createServerFn({ method: "POST" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para atualizar as notificações.", 401);

  const db = await adminDb();
  const result = await callRuntimeRpc<number>(db, "mark_model_lab_events_read", { p_owner_id: userId });
  if (result.error) {
    throw new BackendError("INTERNAL_ERROR", "Não foi possível marcar as novidades como lidas.", 500);
  }
  return { marked: Number(result.data ?? 0) };
});
