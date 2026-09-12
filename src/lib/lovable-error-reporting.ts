type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
    __lovableReportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string;
    }) => void;
  }
}

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|p256dh|auth|endpoint|email|ip(?:_address)?)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const PUSH_URL = /https:\/\/(?:web\.push\.apple\.com|fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push(?:-[a-z0-9-]+)?\.services\.mozilla\.com)\/[^\s"']+/gi;

export function redactPrivacySensitiveText(value: string) {
  return value
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[jwt]")
    .replace(PUSH_URL, "[push-endpoint]")
    .replace(EMAIL, "[email]")
    .replace(UUID, "[uuid]");
}

export function sanitizePrivacyTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return redactPrivacySensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => sanitizePrivacyTelemetry(entry, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactPrivacySensitiveText(value.message),
      stack: value.stack ? redactPrivacySensitiveText(value.stack) : undefined,
    };
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      sanitized[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizePrivacyTelemetry(nested, depth + 1);
    }
    return sanitized;
  }
  return redactPrivacySensitiveText(String(value));
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const rawMessage =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const message = redactPrivacySensitiveText(rawMessage);
  const stack = error instanceof Error && error.stack ? redactPrivacySensitiveText(error.stack) : undefined;
  const safeContext = sanitizePrivacyTelemetry({
    source: "react_error_boundary",
    route: window.location.pathname,
    ...context,
  }) as Record<string, unknown>;
  const safeError = error instanceof Error ? new Error(message) : message;
  if (safeError instanceof Error && stack) safeError.stack = stack;

  window.__lovableEvents?.captureException?.(safeError, safeContext, {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });

  window.__lovableReportRuntimeError?.({
    message,
    ...(stack !== undefined && { stack }),
    filename: redactPrivacySensitiveText(window.location.pathname),
  });
}
