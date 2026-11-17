import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { digest } from "../lib/assistant/gaps.ts";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

/**
 * Monday morning: email the hospital's staff the questions AIRMA couldn't
 * answer last week (lib/assistant/gaps.ts `digest`), through Resend. Off until
 * `RESEND_API_KEY`, `GAPS_DIGEST_TO` (addresses, comma-separated) and
 * `GAPS_DIGEST_FROM` (a sender on a domain verified at Resend) are set.
 */
export const send = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.RESEND_API_KEY,
      to = (process.env.GAPS_DIGEST_TO ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      from = process.env.GAPS_DIGEST_FROM,
      site = process.env.SITE_URL;
    if (!key || !to.length || !from || !site) return;
    for (const h of await ctx.runQuery(internal.gaps.forDigest, {})) {
      const mail = digest(h.title, h.gaps, `${site.replace(/\/$/, "")}/editor/info#unanswered`, Date.now());
      if (!mail) continue;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) console.error(`Could not send the weekly email for ${h.slug}:`, res.status, await res.text());
    }
  },
});
