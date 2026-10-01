import { redirect } from "@sveltejs/kit";
import { createConvexHttpClient } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { nextPath, signedIn } from "$lib/server/editor";
import { api } from "../../convex/_generated/api";

export const load = async (event) => {
  const me = await signedIn(event),
    next = nextPath(event.url);
  // Already an editor: straight on.
  if (me?.editor) redirect(303, next);
  return {
    account: me && { email: me.email },
    next,
    /** No accounts yet: the first one is created here and becomes the admin. */
    first: !me && (await createConvexHttpClient().query(api.auth.open, {})),
  };
};
