// Parser e validação do CSV (Partida, Horário, Campeonato).
// Client-safe: usado na Tela 1 para pré-validar antes de enviar ao backend.

export interface CsvRow {
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
}

const REQUIRED = ["partida", "horario", "campeonato"] as const;

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

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): CsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], invalid: [], headers: [], leagues: [] };
  }

  const delimiter = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitLine(lines[0]!, delimiter);
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
    };
  }

  const rows: CsvRow[] = [];
  const invalid: CsvInvalidRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    const partida = sanitize(cells[idx["partida"]!] ?? "");
    const horario = sanitize(cells[idx["horario"]!] ?? "");
    const campeonato = sanitize(cells[idx["campeonato"]!] ?? "");

    if (!partida || !horario || !campeonato) {
      invalid.push({ line: i + 1, raw: lines[i]!, reason: "Campo obrigatório vazio" });
      continue;
    }
    if (!/\d{1,2}[:h]\d{2}/.test(horario)) {
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
    rows.push({ partida, horario, campeonato });
  }

  const leagues = Array.from(new Set(rows.map((r) => r.campeonato))).sort();
  return { rows, invalid, headers, leagues };
}
