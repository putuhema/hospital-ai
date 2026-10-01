import type { RequestHandler } from "@sveltejs/kit";
import { createSvelteKitHandler } from "@mmailaender/convex-better-auth-svelte/sveltekit";

// Editor sign-in, passed on to the Convex deployment (PUBLIC_CONVEX_SITE_URL), which keeps the accounts.
const proxy = createSvelteKitHandler();

/**
 * The auth client cancels a session or token request it no longer needs; the
 * request to Convex isn't tied to it, so it finishes quietly instead of
 * failing with an AbortError (a 500 in the log).
 */
const detached =
  (handler: RequestHandler): RequestHandler =>
  (event) =>
    handler({ ...event, request: new Request(event.request, { signal: null }) });

export const GET = detached(proxy.GET);
export const POST = detached(proxy.POST);
