const STATE_CACHE = "bet-value-push-state-v1";
const TARGET_KEY = "/__bet-value/latest-analysis-target";
const MANUAL_TARGET_TTL_MS = 10 * 60 * 1000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SET_ANALYSIS_TARGET") return;
  const url = typeof event.data.url === "string" ? event.data.url : "/";
  event.waitUntil(
    caches.open(STATE_CACHE).then((cache) =>
      cache.put(
        TARGET_KEY,
        new Response(JSON.stringify({ url, setAt: Date.now() }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

async function latestTarget() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const response = await cache.match(TARGET_KEY);
    if (!response) return "/";
    const data = await response.json();
    const fresh = typeof data?.setAt === "number" && Date.now() - data.setAt <= MANUAL_TARGET_TTL_MS;
    const safePath = typeof data?.url === "string" && data.url.startsWith("/");
    if (!fresh || !safePath) {
      await cache.delete(TARGET_KEY);
      return "/";
    }
    return data.url;
  } catch {
    return "/";
  }
}

async function clearTarget() {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.delete(TARGET_KEY);
  } catch {
    // A stale deep-link cache must never block opening the app.
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const url = await latestTarget();
      await self.registration.showNotification("Análise pronta", {
        body: "Sua análise terminou. Toque para conferir as odds.",
        icon: "/icons/icon-192.png",
        badge: "/icons/favicon-32.png",
        tag: "bet-value-analysis-ready",
        renotify: true,
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const path = event.notification?.data?.url || "/";
      const url = new URL(path, self.location.origin).href;
      await clearTarget();
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
