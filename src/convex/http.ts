import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();

// Sign-in and sessions, reached through the app's /api/auth.
authComponent.registerRoutes(http, createAuth);

/** Larger than any hospital's snapshot; anything bigger isn't one. */
const MAX_PUSH = 600_000;
const answer = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Where the bridge at the hospital sends SIMRS's live figures
 * (bridge/khanza-bridge.ts): `{ slug?, snapshot }` with the secret both sides
 * hold as a bearer token (`npx convex env set SIMRS_BRIDGE_SECRET …`).
 */
http.route({
  path: "/simrs/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.SIMRS_BRIDGE_SECRET;
    if (!expected) return answer(503, { error: "SIMRS_BRIDGE_SECRET is not set on this deployment" });
    if (request.headers.get("authorization") !== `Bearer ${expected}`) return answer(401, { error: "Not allowed" });
    const raw = await request.text();
    if (raw.length > MAX_PUSH) return answer(413, { error: "Too large" });
    let body: { slug?: unknown; snapshot?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return answer(400, { error: "Not JSON" });
    }
    const result = await ctx.runMutation(internal.live.push, {
      ...(typeof body.slug === "string" && body.slug && { slug: body.slug }),
      snapshot: body.snapshot,
    });
    return result.ok ? answer(200, result) : answer(400, result);
  }),
});

export default http;
