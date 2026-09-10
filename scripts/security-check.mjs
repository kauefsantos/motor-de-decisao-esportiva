import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function walk(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

assert(
  !fs.existsSync(path.join(root, "src/routes/api.elo-sync.ts")),
  "Legacy /api/elo-sync route must remain removed.",
);

const start = read("src/start.ts");
assert(start.includes("createCsrfMiddleware"), "TanStack CSRF middleware is missing.");
assert(start.includes("requireSupabaseAuth"), "Global server-function auth middleware is missing.");

const auth = read("src/integrations/supabase/auth-middleware.ts");
assert(auth.includes("ALLOWED_EMAIL"), "Single-user allowlist is missing from auth middleware.");
assert(auth.includes("provider !== 'google'"), "Google provider enforcement is missing from auth middleware.");

const headers = read("src/lib/security-headers.ts");
for (const header of [
  "Content-Security-Policy",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-Content-Type-Options",
]) {
  assert(headers.includes(header), `Required security header missing: ${header}`);
}

const migration = read("supabase/migrations/20260910011500_audit_hardening_round2.sql");
for (const marker of [
  "revoke usage on schema public from anon, authenticated",
  "external_api_take_rate_slot",
  "app_create_run_atomic",
  "app_replace_value_results_atomic",
  "min_stake_brl = 0.50",
]) {
  assert(migration.includes(marker), `Database hardening marker missing: ${marker}`);
}

const bankroll = read("src/lib/bankroll.functions.ts");
assert(
  bankroll.includes("modelStake > 0 && modelStake < minStakeBrl") &&
    bankroll.includes("Math.min(maxAllowed, minStakeBrl)"),
  "Operational BRL 0.50 floor behavior is missing from bankroll suggestion logic.",
);

const sourceFiles = walk("src").filter((file) => /\.(?:ts|tsx|js|jsx)$/.test(file));
const htmlInjectionFiles = sourceFiles.filter((file) =>
  read(file).includes("dangerouslySetInnerHTML"),
);
const reviewedChartSink = "src/components/ui/chart.tsx";
assert(
  htmlInjectionFiles.every((file) => file === reviewedChartSink) &&
    htmlInjectionFiles.length <= 1,
  `Unreviewed dangerouslySetInnerHTML usage found: ${htmlInjectionFiles.join(", ")}`,
);
if (htmlInjectionFiles.includes(reviewedChartSink)) {
  const chart = read(reviewedChartSink);
  assert(
    chart.includes("Object.entries(THEMES)") && chart.includes("ChartConfig"),
    "Reviewed chart CSS injection changed shape and requires a new security review.",
  );
}

const appSource = sourceFiles.map((file) => `${file}\n${read(file)}`).join("\n");
const secretAssignment = /(?:SUPABASE_SERVICE_ROLE_KEY|FIVE_DOLLAR_FOOTBALL_API_KEY|LOVABLE_CRON_SECRET)\s*=\s*["'][^"']+["']/;
assert(
  !secretAssignment.test(appSource),
  "A server credential appears to be hard-coded in source.",
);

if (failures.length) {
  console.error("Security regression check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Security regression check passed.");
