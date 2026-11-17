"use node";
import webpush from "web-push";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

/**
 * Send the queue alerts that are due at a hospital (alerts.ts), after the
 * bridge reported. Needs the VAPID keys on this deployment
 * (`npx convex env set VAPID_PUBLIC_KEY …`, `VAPID_PRIVATE_KEY`) and
 * `SITE_URL` (or `VAPID_SUBJECT`); without them nothing is sent.
 */
export const send = internalAction({
  args: { hospitalId: v.id("hospitals") },
  handler: async (ctx, { hospitalId }) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY,
      privateKey = process.env.VAPID_PRIVATE_KEY,
      // Push services want to know who sends (an https: or mailto: address): VAPID_SUBJECT, else the app's
      // own address (http://localhost while developing is sent as https).
      subject = process.env.VAPID_SUBJECT || process.env.SITE_URL?.replace(/^http:/, "https:");
    if (!publicKey || !privateKey || !subject) return;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const { send, over } = await ctx.runQuery(internal.alerts.due, { hospitalId });
    const gone = [...over];
    await Promise.all(
      send.map(async (alert) => {
        try {
          // Urgent, and useless an hour later.
          await webpush.sendNotification(alert.subscription, JSON.stringify(alert.message), { TTL: 3600, urgency: "high" });
          await ctx.runMutation(internal.alerts.sent, { id: alert.id, step: alert.step });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // The phone unsubscribed or the address expired.
          if (status === 404 || status === 410) gone.push(alert.id);
          else console.error("Could not send a queue alert:", status ?? err);
        }
      }),
    );
    if (gone.length) await ctx.runMutation(internal.alerts.drop, { ids: gone });
  },
});
