import {
  createECDH,
  createHash,
  createPrivateKey,
  sign as cryptoSign,
} from "node:crypto";

import { isTrustedPushEndpoint } from "./push-endpoint";

const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);

function base64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function deriveVapidKeyPair() {
  const rootSecret = process.env["LOVABLE_CRON_SECRET"];
  if (!rootSecret) throw new Error("LOVABLE_CRON_SECRET ausente no servidor.");

  // Domain separation keeps the derived Web Push signing key independent from
  // cron authentication itself. Only the derived public key leaves server code.
  const digest = createHash("sha256")
    .update("bet-value-web-push-v1\0", "utf8")
    .update(rootSecret, "utf8")
    .digest();

  const scalar = (BigInt(`0x${digest.toString("hex")}`) % (P256_ORDER - 1n)) + 1n;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateBytes);
  const publicBytes = ecdh.getPublicKey(undefined, "uncompressed");
  const x = publicBytes.subarray(1, 33);
  const y = publicBytes.subarray(33, 65);

  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64Url(x),
      y: base64Url(y),
      d: base64Url(privateBytes),
    },
    format: "jwk",
  });

  return {
    publicKey: base64Url(publicBytes),
    privateKey,
  };
}

function makeVapidAuthorization(endpoint: string) {
  const { publicKey, privateKey } = deriveVapidKeyPair();
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: now + 12 * 60 * 60,
        sub: "https://quant-football-insights.lovable.app",
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = cryptoSign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return {
    publicKey,
    authorization: `vapid t=${unsigned}.${base64Url(signature)}, k=${publicKey}`,
  };
}

export function getVapidPublicKey() {
  return deriveVapidKeyPair().publicKey;
}

export async function sendAnalysisReadyPush(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Generated Database types are refreshed separately from migrations. Keep this
  // new server-only table behind the service-role boundary until that refresh.
  const db = supabaseAdmin as any;
  const { data: subscriptions, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint")
    .eq("user_id", userId);

  if (error) throw error;
  if (!subscriptions?.length) return { sent: 0, removed: 0, failed: 0 };

  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    if (!isTrustedPushEndpoint(subscription.endpoint)) {
      await db.from("push_subscriptions").delete().eq("id", subscription.id);
      removed += 1;
      console.warn("[Web Push] removed untrusted subscription endpoint", {
        subscriptionId: subscription.id,
      });
      continue;
    }

    try {
      const { authorization } = makeVapidAuthorization(subscription.endpoint);
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: authorization,
          TTL: "900",
          Urgency: "normal",
        },
      });

      if (response.ok) {
        sent += 1;
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        await db.from("push_subscriptions").delete().eq("id", subscription.id);
        removed += 1;
        continue;
      }

      failed += 1;
      console.error("[Web Push] delivery rejected", {
        status: response.status,
        endpointOrigin: new URL(subscription.endpoint).origin,
      });
    } catch (error) {
      failed += 1;
      console.error("[Web Push] delivery failed", error);
    }
  }

  return { sent, removed, failed };
}
