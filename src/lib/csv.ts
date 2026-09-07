// Parser e validação do CSV (Data, Partida, Horário, Campeonato).
// Client-safe: usado na Tela 1 para pré-validar antes de enviar ao backend.
// Aceita CSV convencional separado por vírgula/ponto e vírgula e também o
// formato operacional atual: Data;Partida,Horário,Campeonato.

export interface CsvRow {
  data: string; // ISO YYYY-MM-DD
  partida: string;
  horario: string;
  campeonato: string;
}

export interface CsvInvalidRow {
  line: number;
  raw: string;
  reason: string;
}

export interface CsvParseResult {
  rows: CsvRow[];
  invalid: CsvInvalidRow[];
  headers: string[];
  leagues: string[];
  targetDate: string | null;
}

const REQUIRED = ["data", "partida", "horario", "campeonato"] as const;

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Sanitização básica: remove control chars e prefixos de fórmula. */
function sanitize(v: string) {
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
}

/**
 * Divide a linha respeitando aspas e aceitando vírgula OU ponto e vírgula
 * como separadores. Isso suporta tanto CSVs padrão quanto o modelo misto
 * Data;Partida,Horário,Campeonato usado no fluxo diário.
 */
function splitFlexibleLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if ((c === "," || c === ";") && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** DD/MM/YYYY (preferido) ou YYYY-MM-DD -> ISO YYYY-MM-DD, com validação real. */
export function parseDateToIso(value: string): string | null {
  const clean = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const br = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (br) {
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCsv(text: string): CsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], invalid: [], headers: [], leagues: [], targetDate: null };
  }

  const headers = splitFlexibleLine(lines[0]!);
  const normHeaders = headers.map(norm);

  const idx: Record<string, number> = {};
  for (const key of REQUIRED) {
    idx[key] = normHeaders.indexOf(key);
  }

  const missing = REQUIRED.filter((k) => idx[k] === -1);
  if (missing.length > 0) {
    return {
      rows: [],
      invalid: [
        {
          line: 1,
          raw: lines[0]!,
          reason: `Colunas obrigatórias ausentes: ${missing.join(", ")}`,
        },
      ],
      headers,
      leagues: [],
      targetDate: null,
    };
  }

  const rows: CsvRow[] = [];
  const invalid: CsvInvalidRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitFlexibleLine(lines[i]!);
    const dataRaw = sanitize(cells[idx["data"]!] ?? "");
    const data = parseDateToIso(dataRaw);
    const partida = sanitize(cells[idx["partida"]!] ?? "");
    const horario = sanitize(cells[idx["horario"]!] ?? "");
    const campeonato = sanitize(cells[idx["campeonato"]!] ?? "");

    if (!dataRaw || !partida || !horario || !campeonato) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Campo obrigatório vazio" });
      continue;
    }
    if (!data) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Data inválida; use DD/MM/AAAA" });
      continue;
    }
    if (!/^\d{1,2}[:h]\d{2}$/.test(horario)) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Horário em formato não reconhecido" });
      continue;
    }
    if (!/(\s(x|vs|v)\s)|(\s-\s)/i.test(partida)) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Partida sem separador de mandante/visitante" });
      continue;
    }
    if (partida.length > 160 || campeonato.length > 120) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Campo excede limite de caracteres" });
      continue;
    }
    rows.push({ data, partida, horario, campeonato });
  }

  const dates = Array.from(new Set(rows.map((r) => r.data))).sort();
  if (dates.length > 1) {
    return {
      rows: [],
      invalid: [
        ...invalid,
        {
          line: 1,
          raw: lines[0]!,
          reason: `O arquivo contém mais de uma data (${dates.join(", ")}). Envie uma data por análise.`,
        },
      ],
      headers,
      leagues: [],
      targetDate: null,
    };
  }

  const leagues = Array.from(new Set(rows.map((r) => r.campeonato))).sort();
  return { rows, invalid, headers, leagues, targetDate: dates[0] ?? null };
}
