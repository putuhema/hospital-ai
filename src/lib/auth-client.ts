import { createAuthClient } from "better-auth/svelte";
import { adminClient } from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/** Editor accounts (Better Auth), signed in through /api/auth; see convex/auth.ts. Admins manage them at /editor/accounts. */
export const authClient = createAuthClient({ plugins: [convexClient(), adminClient()] });
