const SECRET_ASSIGNMENT = /(authorization|apikey|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|five[_-]?dollar[_-]?football[_-]?api[_-]?key|lovable[_-]?cron[_-]?secret)\s*[:=]\s*["']?([^"'\s,;}]+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SUPABASE_SECRET = /sb_(?:secret|publishable)_[A-Za-z0-9._-]+/g;

export function redactSensitiveText(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(SUPABASE_SECRET, "[REDACTED_SUPABASE_KEY]");
}

export function redactTelemetryValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (value instanceof Error) {
    return redactSensitiveText(value.stack ?? `${value.name}: ${value.message}`);
  }
  if (value === null || value === undefined || typeof value !== "object") return value;

  try {
    return JSON.parse(redactSensitiveText(JSON.stringify(value))) as unknown;
  } catch {
    return "[UNSERIALIZABLE_REDACTED]";
  }
}
