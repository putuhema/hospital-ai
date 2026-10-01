import { redirect } from "@sveltejs/kit";
import { signedIn } from "$lib/server/editor";

// The editor is for the hospital's editors only: anyone else signs in first.
export const load = async (event) => {
  const me = await signedIn(event);
  if (!me?.editor) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
  return { me };
};
