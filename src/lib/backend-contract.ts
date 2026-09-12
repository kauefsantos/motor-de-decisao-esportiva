export type BackendErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type BackendErrorPayload = {
  code: BackendErrorCode;
  message: string;
};

export type BackendSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

export type BackendFailure = {
  ok: false;
  error: BackendErrorPayload;
  requestId: string;
};

export class BackendError extends Error {
  constructor(
    public readonly code: BackendErrorCode,
    public readonly publicMessage: string,
    public readonly status: number,
  ) {
    super(publicMessage);
    this.name = "BackendError";
  }
}

export function backendRequestId() {
  return crypto.randomUUID();
}

export function backendOk<T>(data: T, requestId = backendRequestId()): BackendSuccess<T> {
  return { ok: true, data, requestId };
}

export function normalizeBackendError(error: unknown): { status: number; payload: BackendErrorPayload } {
  if (error instanceof BackendError) {
    return { status: error.status, payload: { code: error.code, message: error.publicMessage } };
  }
  if (error instanceof Error) {
    const text = error.message.toLowerCase();
    if (text.includes("rate") && text.includes("limit")) {
      return { status: 429, payload: { code: "RATE_LIMITED", message: "O provedor atingiu o limite temporário de consultas." } };
    }
    if (text.includes("não autenticado") || text.includes("unauth")) {
      return { status: 401, payload: { code: "UNAUTHENTICATED", message: "Faça login para continuar." } };
    }
    if (text.includes("não encontrada") || text.includes("não encontrado")) {
      return { status: 404, payload: { code: "NOT_FOUND", message: "O recurso solicitado não foi encontrado." } };
    }
    if (text.includes("limite") || text.includes("já foi") || text.includes("conflito")) {
      return { status: 409, payload: { code: "CONFLICT", message: "A operação entrou em conflito com o estado atual. Atualize e tente novamente." } };
    }
  }
  return { status: 500, payload: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação agora." } };
}

export function backendErrorResponse(error: unknown, requestId = backendRequestId()) {
  const normalized = normalizeBackendError(error);
  return Response.json(
    { ok: false, error: normalized.payload, requestId } satisfies BackendFailure,
    { status: normalized.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function backendJson<T>(data: T, init?: ResponseInit, requestId = backendRequestId()) {
  return Response.json(
    { ok: true, data, requestId } satisfies BackendSuccess<T>,
    { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } },
  );
}
