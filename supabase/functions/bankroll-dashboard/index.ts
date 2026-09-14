/* global Deno */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "UNAUTHENTICATED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error("[bankroll-dashboard] missing Lovable Cloud environment variables");
    return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ error: "UNAUTHENTICATED" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ownerId = userData.user.id;
  const [bankrollResult, homeResult, configResult] = await Promise.all([
    admin.rpc("get_owner_bankroll_metrics", { p_owner_id: ownerId }),
    admin.rpc("get_owner_home_metrics", { p_owner_id: ownerId }),
    admin
      .from("experimental_bankroll_config")
      .select("id,start_date,initial_bankroll,max_stake_pct,fractional_kelly,min_stake_brl,updated_at")
      .eq("id", "main")
      .eq("owner_id", ownerId)
      .maybeSingle(),
  ]);

  if (bankrollResult.error || homeResult.error || configResult.error) {
    console.error("[bankroll-dashboard] canonical snapshot failed", {
      bankroll: bankrollResult.error?.message,
      home: homeResult.error?.message,
      config: configResult.error?.message,
    });
    return json({ error: "BANKROLL_SNAPSHOT_UNAVAILABLE" }, 500);
  }

  const bankrollRow = Array.isArray(bankrollResult.data) ? bankrollResult.data[0] : bankrollResult.data;
  const homeRow = Array.isArray(homeResult.data) ? homeResult.data[0] : homeResult.data;
  const config = configResult.data;
  if (!bankrollRow || !config) {
    return json({ error: "BANKROLL_CONFIG_NOT_FOUND" }, 404);
  }

  return json({
    generatedAt: new Date().toISOString(),
    bankroll: {
      initial: number(bankrollRow.initial_bankroll),
      equity: number(bankrollRow.current_equity),
      available: number(bankrollRow.available_bankroll),
      locked: number(bankrollRow.locked_stake),
      settledProfit: number(bankrollRow.settled_profit),
      maxStakePct: number(bankrollRow.max_stake_pct),
      fractionalKelly: number(bankrollRow.fractional_kelly),
      minStakeBrl: number(bankrollRow.min_stake_brl, 0.5),
    },
    tracking: {
      openBetsCount: number(homeRow?.open_bets_count),
      proposedCount: number(homeRow?.proposed_count),
      settledProfit: number(homeRow?.settled_profit),
      lockedStake: number(homeRow?.locked_stake),
    },
    config: {
      id: config.id,
      startDate: config.start_date,
      updatedAt: config.updated_at,
    },
  });
});
