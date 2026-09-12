export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMsAt(epochMs: number) {
  const p = partsAt(new Date(epochMs));
  const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return representedAsUtc - Math.floor(epochMs / 1000) * 1000;
}

function parseDate(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Data local inválida: ${isoDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTime(hhmm: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Horário local inválido: ${hhmm}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Horário local inválido: ${hhmm}`);
  return { hour, minute };
}

export function saoPauloLocalDateTimeToIso(isoDate: string, hhmm: string) {
  const d = parseDate(isoDate);
  const t = parseTime(hhmm);
  const wallClockUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0);
  let candidate = wallClockUtc;

  // Two/three passes resolve the zone offset around historical DST boundaries
  // without hard-coding UTC-3 or UTC-2.
  for (let i = 0; i < 4; i += 1) {
    const next = wallClockUtc - offsetMsAt(candidate);
    if (Math.abs(next - candidate) < 1000) {
      candidate = next;
      break;
    }
    candidate = next;
  }
  return new Date(candidate).toISOString();
}

function addCalendarDays(isoDate: string, days: number) {
  const d = parseDate(isoDate);
  const noon = new Date(Date.UTC(d.year, d.month - 1, d.day + days, 12));
  return noon.toISOString().slice(0, 10);
}

export function saoPauloLocalDayUnixWindow(isoDate: string) {
  const startMs = Date.parse(saoPauloLocalDateTimeToIso(isoDate, "00:00"));
  const nextDate = addCalendarDays(isoDate, 1);
  const endMs = Date.parse(saoPauloLocalDateTimeToIso(nextDate, "00:00"));
  return { start: Math.floor(startMs / 1000), end: Math.floor(endMs / 1000) };
}
