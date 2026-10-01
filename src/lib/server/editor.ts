import type { RequestEvent } from "@sveltejs/kit";
import { createConvexHttpClient, getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { api } from "../../convex/_generated/api";

/** A fresh Convex token for the request's sign-in session, or undefined when signed out. */
async function freshToken(fetch: RequestEvent["fetch"]) {
  const res = await fetch("/api/auth/convex/token").catch(() => null);
  if (!res?.ok) return undefined;
  return ((await res.json()) as { token?: string }).token ?? undefined;
}

async function whoIs(token: string | undefined) {
  if (!token) return null;
  return createConvexHttpClient({ token })
    .query(api.auth.me, {})
    .catch(() => null);
}

/** Who is signed in on this request (Convex checks the session), or null. */
export async function signedIn({ cookies, fetch }: RequestEvent) {
  // The token kept in a cookie lasts 15 minutes; past that, the session gives a new one.
  return (await whoIs(getToken(cookies))) ?? (await whoIs(await freshToken(fetch)));
}

/** Where to go after signing in: a path on this site, the editor otherwise. */
export function nextPath(url: URL) {
  const next = url.searchParams.get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/editor";
}
