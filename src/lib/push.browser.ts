export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

export function supportsWebPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerBetValueServiceWorker() {
  if (!supportsWebPush()) return null;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function setAnalysisNotificationTarget(runId: string) {
  const registration = await registerBetValueServiceWorker();
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  worker?.postMessage({
    type: "SET_ANALYSIS_TARGET",
    url: `/run/${runId}/oportunidades`,
  });
}

export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function arrayBufferToBase64Url(value: ArrayBuffer | null) {
  if (!value) return "";
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
