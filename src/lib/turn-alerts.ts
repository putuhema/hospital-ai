/**
 * The phone's side of queue alerts (model/turn-alerts.ts): ask to show
 * notifications, subscribe to Web Push through the service worker, and give
 * the server the ticket to watch. Works in Chrome and Firefox on Android and
 * desktop, and on iPhone once AIRMA is added to the home screen.
 */
import type { ConvexClient } from "convex/browser";
import { env } from "$env/dynamic/public";
import { api } from "../convex/_generated/api";
import type { Lang } from "./i18n/lang.ts";
import type { Ticket } from "./model/live.ts";

/** What this phone can do: alerts, alerts once added to the home screen (iPhone in Safari), or none. */
export function alertSupport(): "yes" | "install" | "no" {
  if (typeof window === "undefined" || !env.PUBLIC_VAPID_KEY) return "no";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "yes";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone ? "install" : "no";
}

/** The VAPID key as the push manager takes it. */
function key(base64: string) {
  const s = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Start telling this phone about the ticket. "denied" when the visitor said no to notifications. */
export async function startAlerts(convex: ConvexClient, slug: string | undefined, ticket: Ticket, lang: Lang): Promise<"on" | "denied" | "failed"> {
  try {
    if ((await Notification.requestPermission()) !== "granted") return "denied";
    const registration = await navigator.serviceWorker.ready;
    const sub =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(env.PUBLIC_VAPID_KEY!) }));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await convex.mutation(api.alerts.subscribe, {
      ...(slug && { slug }),
      ticket,
      lang,
      subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
    });
    return "on";
  } catch (err) {
    console.error("Could not turn on queue alerts:", err);
    return "failed";
  }
}

/** Stop telling this phone. */
export async function stopAlerts(convex: ConvexClient) {
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await convex.mutation(api.alerts.unsubscribe, { endpoint: sub.endpoint });
  } catch {
    // Offline: the server forgets it by tomorrow anyway.
  }
}
