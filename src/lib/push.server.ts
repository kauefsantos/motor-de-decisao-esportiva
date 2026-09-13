import {
  createECDH,
  createHash,
  createPrivateKey,
  sign as cryptoSign,
} from "node:crypto";

import { isTrustedPushEndpoint } from "./push-endpoint";

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const PUSH_TIMEOUT_MS = 10_000;

function base64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function deriveVapidKeyPair() {
  const rootSecret = process.env["LOVABLE_CRON_SECRET"];
  if (!rootSecret) throw new Error("LOVABLE_CRON_SECRET ausente no servidor.");
  const digest = createHash("sha256").update("bet-value-web-push-v1\0", "utf8").update(rootSecret, "utf8").digest();
  const scalar = (BigInt(`0x${digest.toString("hex")}`) % (P256_ORDER - 1n)) + 1n;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateBytes);
  const publicBytes = ecdh.getPublicKey(undefined, "uncompressed");
  const x = publicBytes.subarray(1, 33);
  const y = publicBytes.subarray(33, 65);
  const privateKey = createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: base64Url(x), y: base64Url(y), d: base64Url(privateBytes) },
    format: "jwk",
  });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  return { publicKey: base64Url(publicBytes), privateKeyPem };
}

function makeVapidAuthorization(endpoint: string) {
  const { publicKey, privateKeyPem } = deriveVapidKeyPair();
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64Url(Buffer.from(JSON.stringify({ aud: audience, exp: now + 12 * 60 * 60, sub: "https://quant-football-insights.lovable.app" })));
  const unsigned = `${header}.${payload}`;
  const signature = cryptoSign("sha256", Buffer.from(unsigned), { key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return { publicKey, authorization: `vapid t=${unsigned}.${base64Url(signature)}, k=${publicKey}` };
}

export function getVapidPublicKey() {
  return deriveVapidKeyPair().publicKey;
}

type DeliveryState = { resolvedSubscriptionIds?: string[] } | null | undefined;

export async function deliverAnalysisReadyPush(userId: string, state?: DeliveryState) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: subscriptions, error } = await db.from("push_subscriptions").select("id, endpoint").eq("user_id", userId);
  if (error) throw error;

  const resolved = new Set<string>(state?.resolvedSubscriptionIds ?? []);
  let sent = 0;
  let removed = 0;
  let transientFailed = 0;
  let permanentFailed = 0;
  let lastError: string | null = null;

  for (const subscription of subscriptions ?? []) {
    if (resolved.has(subscription.id)) continue;
    if (!isTrustedPushEndpoint(subscription.endpoint)) {
      await db.from("push_subscriptions").delete().eq("id", subscription.id);
      resolved.add(subscription.id);
      removed += 1;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const { authorization } = makeVapidAuthorization(subscription.endpoint);
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: authorization, TTL: "900", Urgency: "normal" },
      });
      if (response.ok) {
        resolved.add(subscription.id);
        sent += 1;
      } else if (response.status === 404 || response.status === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id);
        resolved.add(subscription.id);
        removed += 1;
      } else if (response.status === 429 || response.status >= 500) {
        transientFailed += 1;
        lastError = `Web Push temporariamente indisponível (HTTP ${response.status}).`;
      } else {
        permanentFailed += 1;
        lastError = `Web Push rejeitou a entrega (HTTP ${response.status}).`;
      }
    } catch (error) {
      transientFailed += 1;
      lastError = error instanceof Error && error.name === "AbortError"
        ? `Timeout de ${PUSH_TIMEOUT_MS} ms no Web Push.`
        : error instanceof Error ? error.message : "Falha de rede no Web Push.";
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    sent,
    removed,
    transientFailed,
    permanentFailed,
    lastError,
    deliveryState: { resolvedSubscriptionIds: [...resolved] },
  };
}

// Kept for compatibility with any older internal caller; new analysis completion
// uses the durable outbox and dispatcher route.
export async function sendAnalysisReadyPush(userId: string) {
  const result = await deliverAnalysisReadyPush(userId);
  return { sent: result.sent, removed: result.removed, failed: result.transientFailed + result.permanentFailed };
}
